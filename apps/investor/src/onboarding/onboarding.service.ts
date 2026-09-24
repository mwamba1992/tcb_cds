import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { INVESTOR_EVENTS } from '@govsec/events';
import { generateReference } from '@govsec/reference';
import { CbsClient } from '../clients/clients';
import { CONFIG, type InvestorConfig } from '../config/configuration';
import { checkAgainstCbs } from '../checks/cbs-check';
import type { CheckResult } from '../checks/check-result';
import { NIDA_REGISTRY, checkAgainstNida, type NidaRegistry } from '../checks/nida';
import { canAutoApprove, rateRisk } from '../checks/risk';
import { SCREENING_LISTS, screen, type ScreeningLists } from '../checks/screening';
import { DecisionsService, event } from '../kyc/decisions.service';
import { StatusNotifier } from '../notify/status-notifier';
import { PrismaService } from '../prisma/prisma.service';
import type { IndividualProfileDto } from './onboarding.dto';

/** Where the investor is in the journey, for the portal to route on. */
export type NextStep =
  | 'profile'
  | 'submit'
  | 'under_review'
  | 'provide_info'
  | 'awaiting_cds'
  | 'awaiting_bank'
  | 'ready'
  | 'rejected';

const EDITABLE = ['draft', 'info_requested'];

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cbs: CbsClient,
    private readonly decisions: DecisionsService,
    private readonly notifier: StatusNotifier,
    @Inject(NIDA_REGISTRY) private readonly nida: NidaRegistry,
    @Inject(SCREENING_LISTS) private readonly lists: ScreeningLists,
    @Inject(CONFIG) private readonly config: InvestorConfig,
  ) {}

  async mine(accountId: string) {
    return this.view(await this.findOrCreate(accountId));
  }

  async saveProfile(accountId: string, dto: IndividualProfileDto) {
    const investor = await this.findOrCreate(accountId);
    if (!EDITABLE.includes(investor.status)) {
      throw new ConflictException({
        code: 'not_editable',
        message: 'Details cannot be changed while the application is being decided',
      });
    }
    const nidaNumber = dto.nidaNumber.replace(/\D/g, '');
    if (nidaNumber.length !== 20) {
      throw new HttpException({ code: 'invalid_nida', message: 'NIDA number must be 20 digits' }, HttpStatus.BAD_REQUEST);
    }
    const holder = await this.prisma.individualProfile.findUnique({ where: { nidaNumber } });
    if (holder && holder.investorId !== investor.id) {
      // One person, one investor record: two sign-ins sharing a NIN would split one
      // person's holdings, or let someone register with another's identity.
      throw new ConflictException({
        code: 'nida_already_registered',
        message: 'This NIDA number is already registered. Call TCB on 0800 780 100.',
      });
    }

    const data = {
      nidaNumber,
      firstName: dto.firstName.trim(),
      middleName: dto.middleName?.trim() || null,
      lastName: dto.lastName.trim(),
      dateOfBirth: new Date(`${dto.dateOfBirth}T00:00:00Z`),
      gender: dto.gender,
      email: dto.email?.trim().toLowerCase() || null,
      region: dto.region.trim(),
      district: dto.district.trim(),
      address: dto.address.trim(),
      occupation: dto.occupation.trim(),
      sourceOfFunds: dto.sourceOfFunds,
      tin: dto.tin ? dto.tin.replace(/\D/g, '') : null,
      pepDeclared: dto.pepDeclared,
      declaredAccount: dto.tcbAccount ?? null,
    };
    await this.prisma.individualProfile.upsert({
      where: { investorId: investor.id },
      create: { investorId: investor.id, ...data },
      update: data,
    });
    return this.mine(accountId);
  }

  /**
   * Submit for verification: record consent, run every check, rate the risk, then
   * either approve straight through or open a case for the back office.
   */
  async submit(accountId: string, ipAddress: string | undefined) {
    const investor = await this.findOrCreate(accountId);
    if (!EDITABLE.includes(investor.status)) {
      throw new ConflictException({ code: 'already_submitted', message: 'This application has already been submitted' });
    }
    const profile = investor.individual;
    if (!profile) {
      throw new ConflictException({ code: 'profile_missing', message: 'Complete your details before submitting' });
    }

    const fullName = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ');
    const dateOfBirth = profile.dateOfBirth.toISOString().slice(0, 10);
    const checks = await this.runChecks({
      nidaNumber: profile.nidaNumber,
      fullName,
      dateOfBirth,
      declaredAccount: profile.declaredAccount,
    });
    const { risk, reasons } = rateRisk({
      checks: checks.results,
      pepDeclared: profile.pepDeclared,
      sourceOfFunds: profile.sourceOfFunds,
    });
    const autoApprove = canAutoApprove(checks.results, risk);
    const now = new Date();
    const version = this.config.kyc.consentVersion;

    await this.prisma.$transaction(async (tx) => {
      await tx.consent.createMany({
        skipDuplicates: true,
        data: (['terms', 'data_processing', 'cds_mandate'] as const).map((kind) => ({
          investorId: investor.id,
          kind,
          version,
          ipAddress: ipAddress?.slice(0, 64) ?? null,
        })),
      });
      await tx.verification.createMany({
        data: checks.results.map((check) => ({
          investorId: investor.id,
          source: check.source,
          outcome: check.outcome,
          details: { reasons: check.reasons, ...check.details } as never,
        })),
      });
      const link = checks.link;
      await tx.investor.update({
        where: { id: investor.id },
        data: {
          status: 'under_review',
          risk,
          submittedAt: now,
          ...(link?.kind === 'existing'
            ? { bankStatus: 'existing', bankAccount: link.account, cbsCustomerId: link.customerId }
            : {}),
        },
      });
      const base = { investorId: investor.id, accountId, at: now.toISOString() };
      await tx.outboxMessage.createMany({
        skipDuplicates: true,
        data: [event(INVESTOR_EVENTS.onboardingSubmitted, investor.id, { ...base })],
      });
      if (link?.kind === 'existing') {
        await tx.outboxMessage.createMany({
          skipDuplicates: true,
          data: [event(INVESTOR_EVENTS.bankAccountLinked, investor.id, { ...base, bankStatus: 'existing' }, 'existing')],
        });
      }
      if (!autoApprove) {
        const open = await tx.kycCase.findFirst({
          where: { investorId: investor.id, status: { in: ['new', 'info_requested', 'returned', 'awaiting_checker'] } },
        });
        const slaDueAt = new Date(now.getTime() + this.config.kyc.slaHours * 3_600_000);
        if (open) {
          // A resubmission after "information requested" goes back to the queue on
          // the same case, so the reviewer sees its history.
          await tx.kycCase.update({
            where: { id: open.id },
            data: { reasons, risk, status: 'new', slaDueAt, makerId: null, makerAction: null, makerAt: null },
          });
        } else {
          await tx.kycCase.create({
            data: { reference: generateReference('kycCase'), investorId: investor.id, reasons, risk, slaDueAt },
          });
        }
        await tx.outboxMessage.createMany({
          skipDuplicates: true,
          data: [event(INVESTOR_EVENTS.kycCaseOpened, investor.id, { ...base, risk })],
        });
      }
    });

    await this.notifier.send(accountId, 'onboarding.submitted', { name: profile.firstName });
    if (autoApprove) {
      await this.decisions.approve(investor.id, 'auto');
    } else {
      await this.notifier.send(accountId, 'kyc.under_review', { name: profile.firstName });
    }
    this.logger.log(`Investor ${investor.reference} submitted: risk ${risk}, ${autoApprove ? 'auto-approved' : 'to review'}`);
    return this.mine(accountId);
  }

  private async runChecks(input: {
    nidaNumber: string;
    fullName: string;
    dateOfBirth: string;
    declaredAccount: string | null;
  }): Promise<{ results: CheckResult[]; link: ReturnType<typeof checkAgainstCbs>['link'] | null }> {
    const results: CheckResult[] = [];

    let identity = { fullName: input.fullName.toUpperCase(), dateOfBirth: input.dateOfBirth };
    try {
      const nida = checkAgainstNida(input, await this.nida.lookup(input.nidaNumber));
      if (nida.record) identity = { fullName: nida.record.fullName, dateOfBirth: nida.record.dateOfBirth };
      results.push(strip(nida));
    } catch (error) {
      results.push(unavailable('nida', error));
    }

    let link: ReturnType<typeof checkAgainstCbs>['link'] | null = null;
    try {
      const [byNida, byAccount] = await Promise.all([
        this.cbs.customerByNida(input.nidaNumber),
        input.declaredAccount ? this.cbs.customerByAccount(input.declaredAccount) : Promise.resolve(null),
      ]);
      const cbs = checkAgainstCbs({
        nidaNumber: input.nidaNumber,
        identity,
        declaredAccount: input.declaredAccount,
        byNida,
        byAccount,
      });
      link = cbs.link;
      results.push(strip(cbs));
    } catch (error) {
      results.push(unavailable('cbs', error));
    }

    // Screened on the NIDA name as well as the declared one would be ideal; the NIDA
    // name is the legal one, so it is the one screened.
    try {
      results.push(screen('sanctions', identity.fullName, await this.lists.sanctions()));
    } catch (error) {
      results.push(unavailable('sanctions', error));
    }
    try {
      results.push(screen('pep', identity.fullName, await this.lists.peps()));
    } catch (error) {
      results.push(unavailable('pep', error));
    }
    return { results, link };
  }

  private async findOrCreate(accountId: string) {
    const include = { individual: true } as const;
    const existing = await this.prisma.investor.findUnique({ where: { accountId }, include });
    if (existing) return existing;
    try {
      return await this.prisma.investor.create({
        data: { accountId, reference: generateReference('investor') },
        include,
      });
    } catch {
      // Two first requests racing: the other one created it.
      return this.prisma.investor.findUniqueOrThrow({ where: { accountId }, include });
    }
  }

  private view(investor: Awaited<ReturnType<OnboardingService['findOrCreate']>>) {
    const p = investor.individual;
    return {
      reference: investor.reference,
      type: investor.type,
      status: investor.status,
      nextStep: nextStep(investor.status, investor.cdsStatus, p !== null, investor.bankAccount !== null),
      risk: investor.risk,
      bank: { status: investor.bankStatus, account: investor.bankAccount },
      cds: { status: investor.cdsStatus, account: investor.cdsAccount },
      canBid: investor.status === 'approved' && investor.cdsStatus === 'active' && investor.bankAccount !== null,
      profile: p && {
        nidaNumber: p.nidaNumber,
        firstName: p.firstName,
        middleName: p.middleName,
        lastName: p.lastName,
        dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
        gender: p.gender,
        email: p.email,
        region: p.region,
        district: p.district,
        address: p.address,
        occupation: p.occupation,
        sourceOfFunds: p.sourceOfFunds,
        tin: p.tin,
        pepDeclared: p.pepDeclared,
        tcbAccount: p.declaredAccount,
      },
      submittedAt: investor.submittedAt,
      approvedAt: investor.approvedAt,
    };
  }
}

export function nextStep(status: string, cdsStatus: string, hasProfile: boolean, hasBankAccount: boolean): NextStep {
  switch (status) {
    case 'draft':
      return hasProfile ? 'submit' : 'profile';
    case 'info_requested':
      return 'provide_info';
    case 'under_review':
      return 'under_review';
    case 'rejected':
      return 'rejected';
    default:
      // Bidding needs both: the CDS account the securities go to, and the TCB account
      // the money comes from. A new-to-bank investor may get the first before the second.
      if (cdsStatus !== 'active') return 'awaiting_cds';
      return hasBankAccount ? 'ready' : 'awaiting_bank';
  }
}

function strip<T extends CheckResult>(result: T): CheckResult {
  return { source: result.source, outcome: result.outcome, reasons: result.reasons, details: result.details };
}

function unavailable(source: CheckResult['source'], error: unknown): CheckResult {
  return {
    source,
    outcome: 'unavailable',
    reasons: [`${source.toUpperCase()} could not be checked`],
    details: { error: error instanceof Error ? error.message : String(error) },
  };
}

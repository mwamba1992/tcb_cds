import { Injectable, Logger } from '@nestjs/common';
import {
  INVESTOR_EVENTS,
  type BankAccountLinkedPayload,
  type InvestorEventPayload,
  type KycDecisionPayload,
} from '@govsec/events';
import { generateReference } from '@govsec/reference';
import { CbsClient } from '../clients/clients';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { StatusNotifier } from '../notify/status-notifier';

type Risk = KycDecisionPayload['risk'];

/**
 * What happens once an investor is approved or rejected, whoever decided it.
 *
 * Auto-approval at submission and a supervisor's final approval run the same code,
 * so the two paths cannot drift: both raise the CDS request, both open a TCB account
 * for a new-to-bank investor, both tell the customer.
 */
@Injectable()
export class DecisionsService {
  private readonly logger = new Logger(DecisionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cbs: CbsClient,
    private readonly notifier: StatusNotifier,
  ) {}

  async approve(investorId: string, decidedBy: 'auto' | 'staff'): Promise<void> {
    const at = new Date();
    const investor = await this.prisma.$transaction(async (tx) => {
      const current = await tx.investor.findUniqueOrThrow({
        where: { id: investorId },
        include: { individual: true },
      });
      const base: InvestorEventPayload = {
        investorId,
        accountId: current.accountId,
        at: at.toISOString(),
      };
      const decision: KycDecisionPayload = { ...base, risk: (current.risk ?? 'low') as Risk, decidedBy };
      await tx.investor.update({
        where: { id: investorId },
        data: { status: 'approved', approvedAt: at, cdsStatus: 'requested' },
      });
      // Unique per investor: a second approval cannot raise a second CDS request.
      await tx.cdsRequest.upsert({
        where: { investorId },
        create: { investorId, reference: generateReference('cdsRequest') },
        update: {},
      });
      await tx.outboxMessage.createMany({
        skipDuplicates: true,
        data: [
          event(INVESTOR_EVENTS.kycApproved, investorId, { ...decision }),
          event(INVESTOR_EVENTS.cdsRequested, investorId, { ...base }),
        ],
      });
      return current;
    });

    if (investor.bankStatus !== 'existing' && investor.individual) {
      await this.requestBankAccount(investor.id, investor.individual);
    }
    await this.notifier.send(investor.accountId, 'kyc.approved', {
      name: investor.individual?.firstName ?? '',
    });
    this.logger.log(`Investor ${investor.reference} approved (${decidedBy})`);
  }

  async reject(investorId: string): Promise<void> {
    const at = new Date();
    const investor = await this.prisma.$transaction(async (tx) => {
      const current = await tx.investor.findUniqueOrThrow({
        where: { id: investorId },
        include: { individual: true },
      });
      await tx.investor.update({ where: { id: investorId }, data: { status: 'rejected' } });
      const payload: KycDecisionPayload = {
        investorId,
        accountId: current.accountId,
        at: at.toISOString(),
        risk: (current.risk ?? 'low') as Risk,
        decidedBy: 'staff',
      };
      await tx.outboxMessage.createMany({
        skipDuplicates: true,
        data: [event(INVESTOR_EVENTS.kycRejected, investorId, { ...payload })],
      });
      return current;
    });
    await this.notifier.send(investor.accountId, 'kyc.rejected', {
      name: investor.individual?.firstName ?? '',
    });
  }

  /** Records a TCB account opened for a new-to-bank investor (cbs.account.opened). */
  async linkOpenedAccount(input: { investorId: string; customerId: string; accountNumber: string }): Promise<void> {
    const investor = await this.prisma.investor.findUnique({
      where: { id: input.investorId },
      include: { individual: true },
    });
    if (!investor) {
      this.logger.warn(`cbs.account.opened for unknown investor ${input.investorId}; ignored`);
      return;
    }
    if (investor.bankStatus === 'opened' && investor.bankAccount === input.accountNumber) return;
    const payload: BankAccountLinkedPayload = {
      investorId: investor.id,
      accountId: investor.accountId,
      bankStatus: 'opened',
      at: new Date().toISOString(),
    };
    await this.prisma.$transaction([
      this.prisma.investor.update({
        where: { id: investor.id },
        data: { bankStatus: 'opened', bankAccount: input.accountNumber, cbsCustomerId: input.customerId },
      }),
      this.prisma.outboxMessage.createMany({
        skipDuplicates: true,
        data: [event(INVESTOR_EVENTS.bankAccountLinked, investor.id, { ...payload }, 'opened')],
      }),
    ]);
    // The CDS account came first; this was the last thing missing (see CdsService).
    if (investor.cdsStatus === 'active' && investor.cdsAccount) {
      await this.notifier.send(investor.accountId, 'cds.opened', {
        name: investor.individual?.firstName ?? '',
        cds: investor.cdsAccount,
      });
    }
  }

  /**
   * Ask Core Banking to open an account. A failure leaves the investor approved with
   * no request; the next approval attempt or an operator retries, and cbs-gateway
   * returns the existing request rather than opening a second account.
   */
  private async requestBankAccount(
    investorId: string,
    profile: { nidaNumber: string; firstName: string; middleName: string | null; lastName: string; dateOfBirth: Date },
  ): Promise<void> {
    try {
      const opening = await this.cbs.requestAccountOpening({
        investorId,
        nidaNumber: profile.nidaNumber,
        fullName: [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' '),
        dateOfBirth: profile.dateOfBirth.toISOString().slice(0, 10),
      });
      await this.prisma.investor.update({
        where: { id: investorId },
        data: { bankStatus: 'requested', accountOpeningRef: opening.reference },
      });
    } catch (error) {
      this.logger.error(
        `Account opening for investor ${investorId} not requested: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export function event(
  eventType: string,
  investorId: string,
  payload: Record<string, unknown>,
  discriminator = '',
) {
  return outboxRow({
    aggregateType: 'investor',
    aggregateId: investorId,
    eventType,
    dedupeKey: discriminator ? `${investorId}:${discriminator}` : `${investorId}:${String(payload['at'] ?? '')}`,
    payload,
  });
}

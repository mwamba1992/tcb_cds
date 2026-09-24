import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { INVESTOR_EVENTS } from '@govsec/events';
import { PERMISSIONS, type AuthenticatedUser } from '@govsec/auth';
import { PrismaService } from '../prisma/prisma.service';
import { DecisionsService, event } from './decisions.service';

export const KYC_ACTIONS = ['approve', 'request-info', 'reject', 'final-approve', 'return'] as const;
export type KycAction = (typeof KYC_ACTIONS)[number];

const MAKER_STATES = ['new', 'returned', 'info_requested'];
const OPEN_STATES = ['new', 'returned', 'info_requested', 'awaiting_checker'];

/**
 * The back-office KYC queue, with maker-checker (TAD §10.1).
 *
 * An officer recommends approval; a different supervisor or compliance officer
 * confirms it. Rejection and requests for information take one person: they cost the
 * customer time, not the bank exposure, and a rejected customer can reapply at a
 * branch.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisions: DecisionsService,
  ) {}

  async list(status?: string) {
    const cases = await this.prisma.kycCase.findMany({
      where: status ? { status } : { status: { in: OPEN_STATES } },
      orderBy: { openedAt: 'asc' },
      take: 200,
      include: { investor: { include: { individual: true, verifications: { orderBy: { checkedAt: 'desc' } } } } },
    });
    return cases.map(caseView);
  }

  async get(reference: string) {
    return caseView(await this.find(reference));
  }

  async act(reference: string, action: KycAction, note: string | undefined, actor: AuthenticatedUser) {
    const kase = await this.find(reference);
    const now = new Date();

    if (action === 'approve' || action === 'request-info' || action === 'reject') {
      demand(actor, PERMISSIONS.kycReview);
      if (!MAKER_STATES.includes(kase.status)) {
        throw new ConflictException({ code: 'invalid_state', message: 'This case is not waiting for a maker decision' });
      }
      const status = action === 'approve' ? 'awaiting_checker' : action === 'reject' ? 'rejected' : 'info_requested';
      // Conditional on the status read above, so two officers acting at once cannot
      // both succeed.
      const updated = await this.prisma.kycCase.updateMany({
        where: { id: kase.id, status: kase.status },
        data: {
          status,
          makerId: actor.accountId,
          makerAction: action,
          makerNote: note ?? null,
          makerAt: now,
          ...(action === 'reject' ? { closedAt: now } : {}),
        },
      });
      if (updated.count !== 1) throw conflict();

      if (action === 'reject') await this.decisions.reject(kase.investorId);
      if (action === 'request-info') {
        await this.prisma.$transaction([
          this.prisma.investor.update({ where: { id: kase.investorId }, data: { status: 'info_requested' } }),
          this.prisma.outboxMessage.createMany({
            skipDuplicates: true,
            data: [
              event(INVESTOR_EVENTS.kycInfoRequested, kase.investorId, {
                investorId: kase.investorId,
                accountId: kase.investor.accountId,
                at: now.toISOString(),
              }),
            ],
          }),
        ]);
      }
    } else {
      demand(actor, PERMISSIONS.kycDecide);
      if (kase.status !== 'awaiting_checker') {
        throw new ConflictException({ code: 'invalid_state', message: 'This case is not waiting for a checker' });
      }
      if (kase.makerId === actor.accountId) {
        throw new ForbiddenException({ code: 'maker_checker', message: 'A different user must approve a decision you made' });
      }
      const approve = action === 'final-approve';
      const updated = await this.prisma.kycCase.updateMany({
        where: { id: kase.id, status: 'awaiting_checker' },
        data: {
          status: approve ? 'approved' : 'returned',
          checkerId: actor.accountId,
          checkerNote: note ?? null,
          checkerAt: now,
          ...(approve ? { closedAt: now } : {}),
        },
      });
      if (updated.count !== 1) throw conflict();
      if (approve) await this.decisions.approve(kase.investorId, 'staff');
    }
    return this.get(reference);
  }

  private async find(reference: string) {
    const kase = await this.prisma.kycCase.findUnique({
      where: { reference },
      include: { investor: { include: { individual: true, verifications: { orderBy: { checkedAt: 'desc' } } } } },
    });
    if (!kase) throw new NotFoundException('Case not found');
    return kase;
  }
}

function demand(actor: AuthenticatedUser, permission: string): void {
  if (!(actor.permissions as readonly string[]).includes(permission)) {
    throw new ForbiddenException({ code: 'forbidden', message: `Requires ${permission}` });
  }
}

function conflict() {
  return new ConflictException({ code: 'invalid_state', message: 'Someone else acted on this case first' });
}

type CaseRow = Awaited<ReturnType<PrismaService['kycCase']['findUniqueOrThrow']>> & {
  investor: {
    reference: string;
    channel: string;
    type: string;
    individual: { firstName: string; middleName: string | null; lastName: string } | null;
    verifications: { source: string; outcome: string; details: unknown; checkedAt: Date }[];
  };
};

/** The case as the back-office screen shows it: comparisons, screening, decisions. */
function caseView(kase: CaseRow) {
  const latest = (source: string) => kase.investor.verifications.find((v) => v.source === source);
  const cbs = latest('cbs');
  const nida = latest('nida');
  const cbsDetails = (cbs?.details ?? {}) as { fields?: unknown[]; newToBank?: boolean };
  const useCbs = !!cbsDetails.fields?.length;
  const fields = (useCbs ? cbsDetails.fields : ((nida?.details ?? {}) as { fields?: unknown[] }).fields) ?? [];
  const screening = ['sanctions', 'pep'].map((source) => {
    const check = latest(source);
    const details = (check?.details ?? {}) as { hits?: { score: number }[] };
    const top = details.hits?.[0];
    return {
      label: source === 'sanctions' ? 'Sanctions lists' : 'PEP',
      result: !check ? 'Not checked' : check.outcome === 'unavailable' ? 'Unavailable' : top ? `Match, ${top.score}% score` : 'No match',
      ok: check?.outcome === 'clear',
    };
  });
  const p = kase.investor.individual;
  return {
    reference: kase.reference,
    investorReference: kase.investor.reference,
    name: p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : '',
    type: kase.investor.type,
    channel: kase.investor.channel,
    reasons: kase.reasons,
    risk: kase.risk,
    status: kase.status,
    openedAt: kase.openedAt,
    slaDueAt: kase.slaDueAt,
    sourceA: 'NIDA',
    sourceB: useCbs ? 'Core banking' : 'Declared',
    newToBank: cbsDetails.newToBank ?? null,
    fields,
    screening,
    maker: kase.makerId ? { id: kase.makerId, action: kase.makerAction, note: kase.makerNote, at: kase.makerAt } : null,
    checker: kase.checkerId ? { id: kase.checkerId, note: kase.checkerNote, at: kase.checkerAt } : null,
  };
}

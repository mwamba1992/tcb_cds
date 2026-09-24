import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { INVESTOR_EVENTS, type CdsOpenedPayload } from '@govsec/events';
import { StatusNotifier } from '../notify/status-notifier';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '@govsec/auth';
import { event } from './decisions.service';
import { audit } from './kyc.service';

/**
 * CDS account opening as a back-office task.
 *
 * BoT's GSS API has no CDS endpoint (TAD Appendix B), so an officer opens the
 * account in the CDS and records its number here. That number is what bids are
 * submitted under, so it is unique across investors and cannot be changed once set.
 */
@Injectable()
export class CdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: StatusNotifier,
  ) {}

  async pending() {
    const requests = await this.prisma.cdsRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { investor: { include: { individual: true } } },
    });
    return requests.map((r) => {
      const p = r.investor.individual;
      return {
        reference: r.reference,
        investorReference: r.investor.reference,
        name: p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : '',
        nidaNumber: p?.nidaNumber ?? null,
        dateOfBirth: p?.dateOfBirth.toISOString().slice(0, 10) ?? null,
        bankAccount: r.investor.bankAccount,
        bankStatus: r.investor.bankStatus,
        requestedAt: r.createdAt,
      };
    });
  }

  async complete(reference: string, cdsAccount: string, actor: AuthenticatedUser) {
    const request = await this.prisma.cdsRequest.findUnique({
      where: { reference },
      include: { investor: { include: { individual: true } } },
    });
    if (!request) throw new NotFoundException('CDS request not found');
    if (request.status === 'completed') {
      throw new ConflictException({ code: 'already_completed', message: 'This CDS account has already been recorded' });
    }
    const holder = await this.prisma.investor.findUnique({ where: { cdsAccount } });
    if (holder) {
      throw new ConflictException({ code: 'cds_account_in_use', message: 'This CDS account belongs to another investor' });
    }

    const now = new Date();
    const payload: CdsOpenedPayload = {
      investorId: request.investorId,
      accountId: request.investor.accountId,
      cdsAccount,
      at: now.toISOString(),
    };
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.cdsRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: {
          status: 'completed',
          cdsAccount,
          completedBy: actor.accountId,
          completedByName: actor.name ?? null,
          completedAt: now,
        },
      });
      if (done.count !== 1) {
        throw new ConflictException({ code: 'already_completed', message: 'This CDS account has already been recorded' });
      }
      await tx.investor.update({
        where: { id: request.investorId },
        data: { cdsStatus: 'active', cdsAccount },
      });
      await tx.staffAction.create({
        data: audit(actor, 'cds.complete', request, `CDS account ${cdsAccount}`, now, 'cds_request'),
      });
      await tx.outboxMessage.createMany({
        skipDuplicates: true,
        data: [event(INVESTOR_EVENTS.cdsOpened, request.investorId, { ...payload }, 'cds')],
      });
    });

    // "You can now bid" is only true once the TCB account exists too. For a new-to-bank
    // investor still waiting for it, the message goes when the account is linked.
    if (request.investor.bankAccount) {
      await this.notifier.send(request.investor.accountId, 'cds.opened', {
        name: request.investor.individual?.firstName ?? '',
        cds: cdsAccount,
      });
    }
    return { reference, status: 'completed', cdsAccount, canBid: request.investor.bankAccount !== null };
  }
}

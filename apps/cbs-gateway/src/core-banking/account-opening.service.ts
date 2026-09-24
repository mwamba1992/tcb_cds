import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CBS_EVENTS, type CbsAccountOpenedPayload } from '@govsec/events';
import { generateReference } from '@govsec/reference';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { CORE_BANKING, type CoreBanking } from './core-banking';

@Injectable()
export class AccountOpeningService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CORE_BANKING) private readonly cbs: CoreBanking,
  ) {}

  /**
   * Record the request, then hand it to Core Banking. Idempotent per investor: a
   * retried onboarding submission gets the first request back rather than a second
   * account.
   */
  async request(input: {
    investorId: string;
    nidaNumber: string;
    fullName: string;
    dateOfBirth: string;
  }): Promise<{ reference: string; status: string }> {
    const existing = await this.prisma.accountOpeningRequest.findUnique({
      where: { investorId: input.investorId },
    });
    if (existing) return { reference: existing.reference, status: existing.status };

    const created = await this.prisma.accountOpeningRequest.create({
      data: {
        reference: generateReference('accountOpening'),
        investorId: input.investorId,
        nidaNumber: input.nidaNumber,
        fullName: input.fullName.toUpperCase(),
        dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
      },
    });
    await this.cbs.submitAccountOpening({
      reference: created.reference,
      nidaNumber: created.nidaNumber,
      fullName: created.fullName,
      dateOfBirth: input.dateOfBirth,
    });
    return { reference: created.reference, status: created.status };
  }

  /**
   * Core Banking has opened the account. In stub mode this is called by hand (or by
   * a demo script); the live adapter will call it from Core Banking's notification.
   */
  async markOpened(reference: string, accountNumber: string): Promise<CbsAccountOpenedPayload> {
    const request = await this.prisma.accountOpeningRequest.findUnique({ where: { reference } });
    if (!request) throw new NotFoundException('No such account-opening request');
    if (request.status === 'opened') {
      if (request.accountNumber !== accountNumber) {
        throw new ConflictException('This request was already opened with a different account');
      }
      return this.payload(request.reference, request.investorId, request.customerId ?? '', accountNumber, request.openedAt ?? new Date());
    }

    const openedAt = new Date();
    const customerId = `CIF-${reference.slice(3, 10)}`;
    const payload = this.payload(reference, request.investorId, customerId, accountNumber, openedAt);
    await this.prisma.$transaction([
      this.prisma.accountOpeningRequest.update({
        where: { reference },
        data: { status: 'opened', accountNumber, customerId, openedAt },
      }),
      this.prisma.outboxMessage.create({
        data: outboxRow({
          aggregateType: 'account_opening',
          aggregateId: reference,
          eventType: CBS_EVENTS.accountOpened,
          dedupeKey: reference,
          payload: { ...payload },
        }),
      }),
    ]);
    return payload;
  }

  private payload(
    reference: string,
    investorId: string,
    customerId: string,
    accountNumber: string,
    openedAt: Date,
  ): CbsAccountOpenedPayload {
    return { reference, investorId, customerId, accountNumber, openedAt: openedAt.toISOString() };
  }
}

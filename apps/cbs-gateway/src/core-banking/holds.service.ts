import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Money } from '@govsec/money';
import { PrismaService } from '../prisma/prisma.service';
import { CORE_BANKING, type CoreBanking } from './core-banking';

export interface HoldView {
  reference: string;
  accountNumber: string;
  amount: string;
  status: string;
}

/**
 * Funds held for bids.
 *
 * With the stub, "available" is the ledger balance less every active hold. With live
 * Core Banking this becomes a lien call and the bank's own available balance; the
 * contract to the auction service stays the same. Placing is idempotent on the bid
 * reference, so a retried bid cannot hold twice.
 */
@Injectable()
export class HoldsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CORE_BANKING) private readonly cbs: CoreBanking,
  ) {}

  async balance(accountNumber: string) {
    const ledger = await this.cbs.ledgerBalance(accountNumber);
    if (ledger === null) throw new NotFoundException({ code: 'unknown_account', message: 'Unknown TCB account' });
    const held = await this.heldOn(accountNumber);
    return {
      accountNumber,
      ledger: this.tzs(ledger),
      onHold: this.tzs(held),
      available: this.tzs(ledger - held),
    };
  }

  async place(reference: string, accountNumber: string, amount: string): Promise<HoldView> {
    const minor = Money.parse(amount, 'TZS').minorUnits;
    const existing = await this.prisma.fundsHold.findUnique({ where: { reference } });
    if (existing) return this.view(existing);

    // Serialised per account so two bids at once cannot both spend the same balance.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountNumber}))`;
      const ledger = await this.cbs.ledgerBalance(accountNumber);
      if (ledger === null) throw new NotFoundException({ code: 'unknown_account', message: 'Unknown TCB account' });
      const held = await tx.fundsHold.aggregate({
        where: { accountNumber, status: 'held' },
        _sum: { amount: true },
      });
      const available = ledger - (held._sum.amount ?? 0n);
      if (minor > available) {
        throw new ConflictException({
          code: 'insufficient_funds',
          message: 'Not enough available balance on the TCB account',
          available: this.tzs(available),
        });
      }
      const hold = await tx.fundsHold.create({ data: { reference, accountNumber, amount: minor } });
      return this.view(hold);
    });
  }

  async adjust(reference: string, amount: string): Promise<HoldView> {
    const minor = Money.parse(amount, 'TZS').minorUnits;
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.fundsHold.findUnique({ where: { reference } });
      if (!hold) throw new NotFoundException('No such hold');
      if (hold.status !== 'held') throw new ConflictException({ code: 'hold_closed', message: 'This hold is no longer active' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hold.accountNumber}))`;
      if (minor > hold.amount) {
        const ledger = (await this.cbs.ledgerBalance(hold.accountNumber)) ?? 0n;
        const held = await tx.fundsHold.aggregate({
          where: { accountNumber: hold.accountNumber, status: 'held' },
          _sum: { amount: true },
        });
        if (minor - hold.amount > ledger - (held._sum.amount ?? 0n)) {
          throw new ConflictException({ code: 'insufficient_funds', message: 'Not enough available balance on the TCB account' });
        }
      }
      return this.view(await tx.fundsHold.update({ where: { reference }, data: { amount: minor } }));
    });
  }

  /** Idempotent: releasing a released hold is a no-op. */
  async release(reference: string): Promise<HoldView> {
    const hold = await this.prisma.fundsHold.findUnique({ where: { reference } });
    if (!hold) throw new NotFoundException('No such hold');
    if (hold.status !== 'held') return this.view(hold);
    return this.view(
      await this.prisma.fundsHold.update({ where: { reference }, data: { status: 'released', releasedAt: new Date() } }),
    );
  }

  private async heldOn(accountNumber: string): Promise<bigint> {
    const held = await this.prisma.fundsHold.aggregate({ where: { accountNumber, status: 'held' }, _sum: { amount: true } });
    return held._sum.amount ?? 0n;
  }

  private tzs(minor: bigint): string {
    return Money.fromMinor(minor, 'TZS').toString();
  }

  private view(h: { reference: string; accountNumber: string; amount: bigint; status: string }): HoldView {
    return { reference: h.reference, accountNumber: h.accountNumber, amount: this.tzs(h.amount), status: h.status };
  }
}

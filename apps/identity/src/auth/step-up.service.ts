import { BadRequestException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { permissionsForRole, requiresStepUp, type Permission, type Role } from '@govsec/auth';
import { InvalidMoneyError, Money } from '@govsec/money';
import { CONFIG, durationMs, type IdentityConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { PinService } from './pin.service';
import { TokenService } from './token.service';

/**
 * PIN approval for one action (TAD §10.1): the `pin_token` sent with a bid.
 *
 * A grant is scoped to one permission and, when given, an amount ceiling. Without
 * both, a PIN entered to amend a small bid would authorise a 500,000,000 TZS one.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
    private readonly tokens: TokenService,
    @Inject(CONFIG) private readonly config: IdentityConfig,
  ) {}

  async grant(
    accountId: string,
    role: Role,
    input: { pin: string; scope: string; amount?: string },
  ): Promise<{ stepUpToken: string; expiresIn: string; scope: Permission }> {
    const scope = input.scope as Permission;
    if (!requiresStepUp(scope)) {
      throw new BadRequestException(`"${input.scope}" is not an action that needs PIN approval`);
    }
    // A PIN proves the person, not what they may do: an investor must not obtain a
    // grant for batch approval just because the PIN is right.
    if (!permissionsForRole(role).includes(scope)) {
      throw new AuthError(HttpStatus.FORBIDDEN, 'action_not_permitted', 'Your role cannot perform this action');
    }

    let maxAmountMinor: bigint | undefined;
    if (input.amount !== undefined) {
      try {
        maxAmountMinor = Money.parse(input.amount, 'TZS').minorUnits;
      } catch (error) {
        if (error instanceof InvalidMoneyError) throw new BadRequestException(error.message);
        throw error;
      }
      if (maxAmountMinor <= 0n) throw new BadRequestException('amount must be positive');
    }

    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    await this.pins.verify(account, input.pin, 'signed_in');

    const grantId = randomUUID();
    await this.prisma.stepUpGrant.create({
      data: {
        id: grantId,
        accountId,
        scope,
        maxAmount: maxAmountMinor ?? null,
        expiresAt: new Date(Date.now() + durationMs(this.config.jwt.stepUpTtl)),
      },
    });
    const issued = await this.tokens.issueStepUp({
      accountId,
      grantId,
      scope,
      ...(maxAmountMinor !== undefined ? { maxAmountMinor } : {}),
    });
    return { ...issued, scope };
  }

  /**
   * Spend a grant. Called by the service performing the action, as it commits.
   *
   * The conditional update is the single-use guarantee: with `consumedAt: null` in
   * the WHERE clause, two concurrent redemptions cannot both match.
   */
  async redeem(input: {
    grantId: string;
    accountId: string;
    scope: Permission;
    amountMinor?: bigint;
  }): Promise<void> {
    const refuse = (message: string) =>
      new AuthError(HttpStatus.FORBIDDEN, 'step_up_refused', message);

    const grant = await this.prisma.stepUpGrant.findUnique({ where: { id: input.grantId } });
    if (!grant || grant.accountId !== input.accountId) throw refuse('Unknown PIN approval');
    if (grant.scope !== input.scope) throw refuse('PIN approval is for a different action');
    if (grant.consumedAt) throw refuse('PIN approval already used');
    if (grant.expiresAt.getTime() <= Date.now()) throw refuse('PIN approval has expired');
    if (grant.maxAmount !== null) {
      if (input.amountMinor === undefined) throw refuse('PIN approval is limited to an amount');
      if (input.amountMinor > grant.maxAmount) throw refuse('Amount exceeds what the PIN approved');
    }

    const claimed = await this.prisma.stepUpGrant.updateMany({
      where: { id: input.grantId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) throw refuse('PIN approval already used');
  }
}

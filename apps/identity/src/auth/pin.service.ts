import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  IDENTITY_EVENTS,
  type AccountLockedPayload,
  type PinSetPayload,
} from '@govsec/events';
import { NotifyClient } from '@govsec/notify';
import { CONFIG, type IdentityConfig } from '../config/configuration';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { PIN_PROBLEM_MESSAGE, pinProblem } from './pin-policy';
import { SecretHasher } from './secret-hasher';

interface PinAccount {
  id: string;
  phoneNumber: string;
  pinHash: string | null;
  pinLockedAt: Date | null;
  locale: string;
}

/**
 * Where the PIN is checked. At sign-in the caller has not proved who they are, so a
 * wrong PIN must look exactly like an unknown number; once signed in, telling the
 * customer how many tries remain is safe and helps them stop before the lockout.
 */
export type PinContext = 'sign_in' | 'signed_in';

@Injectable()
export class PinService {
  private readonly logger = new Logger(PinService.name);
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasher,
    private readonly notify: NotifyClient,
    @Inject(CONFIG) private readonly config: IdentityConfig,
  ) {}

  /**
   * Check a PIN, counting failures toward the lockout.
   *
   * The attempt is reserved before the hash is compared, in one conditional UPDATE.
   * Checking first and counting after would let fifty parallel guesses all pass the
   * "not locked yet" check before any of them was counted.
   */
  async verify(account: PinAccount, pin: string, context: PinContext): Promise<void> {
    if (account.pinLockedAt) throw this.locked();
    if (!account.pinHash) {
      throw context === 'sign_in'
        ? this.invalidSignIn()
        : new AuthError(HttpStatus.CONFLICT, 'pin_not_set', 'Set a transaction PIN first');
    }

    const max = this.config.pin.maxAttempts;
    const reserved = await this.prisma.$queryRaw<{ pin_failed_attempts: number }[]>`
      UPDATE accounts
         SET pin_failed_attempts = pin_failed_attempts + 1
       WHERE id = ${account.id}::uuid
         AND pin_locked_at IS NULL
         AND pin_failed_attempts < ${max}
   RETURNING pin_failed_attempts
    `;
    const attempt = reserved[0]?.pin_failed_attempts;
    if (attempt === undefined) throw this.locked();

    if (await this.hasher.verify(account.pinHash, pin)) {
      await this.prisma.account.update({
        where: { id: account.id },
        data: { pinFailedAttempts: 0 },
      });
      return;
    }

    if (attempt >= max) {
      await this.lock(account.id, attempt);
      throw this.locked();
    }
    if (context === 'sign_in') throw this.invalidSignIn();
    const attemptsRemaining = max - attempt;
    throw new AuthError(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'PIN is incorrect', {
      attemptsRemaining,
    });
  }

  /** Spend the same argon2 time on an unknown number as on a wrong PIN. */
  async burnTime(pin: string): Promise<void> {
    this.dummyHash ??= this.hasher.hash('0000-not-a-pin');
    await this.hasher.verify(await this.dummyHash, pin);
  }

  invalidSignIn(): AuthError {
    return new AuthError(
      HttpStatus.UNAUTHORIZED,
      'invalid_credentials',
      'Phone number or PIN is incorrect',
    );
  }

  /** The first PIN, right after the phone is verified. */
  async setInitial(account: PinAccount, pin: string): Promise<void> {
    this.assertAcceptable(pin);
    const pinHash = await this.hasher.hash(pin);
    const now = new Date();
    const written = await this.prisma.$transaction(async (tx) => {
      // Conditional on no PIN yet, so this endpoint can never overwrite one: changing
      // a PIN needs the current PIN, resetting needs an OTP.
      const updated = await tx.account.updateMany({
        where: { id: account.id, pinHash: null },
        data: { pinHash, pinSetAt: now, pinFailedAttempts: 0 },
      });
      if (updated.count !== 1) return false;
      await tx.outboxMessage.create({ data: this.pinSetEvent(account.id, 'initial', now) });
      return true;
    });
    if (!written) {
      throw new AuthError(HttpStatus.CONFLICT, 'pin_already_set', 'A PIN is already set');
    }
    await this.confirmBySms(account);
  }

  async change(account: PinAccount, currentPin: string, newPin: string): Promise<void> {
    await this.verify(account, currentPin, 'signed_in');
    if (newPin === currentPin) {
      throw new AuthError(HttpStatus.BAD_REQUEST, 'weak_pin', 'New PIN must differ from the current one');
    }
    this.assertAcceptable(newPin);
    const now = new Date();
    const pinHash = await this.hasher.hash(newPin);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: account.id },
        data: { pinHash, pinSetAt: now, pinFailedAttempts: 0 },
      }),
      this.prisma.outboxMessage.create({ data: this.pinSetEvent(account.id, 'change', now) }),
    ]);
    await this.confirmBySms(account);
  }

  /**
   * A new PIN after an OTP, which is also how a lockout is lifted. Every session is
   * revoked: whoever was guessing may also hold a session.
   */
  async reset(account: PinAccount, newPin: string): Promise<void> {
    this.assertAcceptable(newPin);
    const now = new Date();
    const pinHash = await this.hasher.hash(newPin);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: account.id },
        data: { pinHash, pinSetAt: now, pinFailedAttempts: 0, pinLockedAt: null },
      }),
      this.prisma.session.updateMany({
        where: { accountId: account.id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.outboxMessage.create({ data: this.pinSetEvent(account.id, 'reset', now) }),
    ]);
    await this.confirmBySms(account);
  }

  assertAcceptable(pin: string): void {
    const problem = pinProblem(pin);
    if (problem) {
      throw new AuthError(HttpStatus.BAD_REQUEST, 'weak_pin', PIN_PROBLEM_MESSAGE[problem], {
        reason: problem,
      });
    }
  }

  private locked(): AuthError {
    return new AuthError(
      HttpStatus.LOCKED,
      'pin_locked',
      'Too many wrong PINs. Reset your PIN with a code sent to your phone.',
    );
  }

  private async lock(accountId: string, failedAttempts: number): Promise<void> {
    const lockedAt = new Date();
    const payload: AccountLockedPayload = {
      accountId,
      failedAttempts,
      lockedAt: lockedAt.toISOString(),
    };
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.account.updateMany({
        where: { id: accountId, pinLockedAt: null },
        data: { pinLockedAt: lockedAt },
      });
      if (locked.count !== 1) return;
      await tx.session.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: lockedAt },
      });
      await tx.outboxMessage.create({
        data: outboxRow({
          aggregateType: 'account',
          aggregateId: accountId,
          eventType: IDENTITY_EVENTS.accountLocked,
          dedupeKey: `${accountId}:${lockedAt.getTime()}`,
          payload: { ...payload },
        }),
      });
    });
    this.logger.warn(`Account ${accountId} locked after ${failedAttempts} wrong PINs`);
  }

  private pinSetEvent(accountId: string, reason: PinSetPayload['reason'], at: Date) {
    const payload: PinSetPayload = { accountId, reason, at: at.toISOString() };
    return outboxRow({
      aggregateType: 'account',
      aggregateId: accountId,
      eventType: IDENTITY_EVENTS.pinSet,
      dedupeKey: `${accountId}:${at.getTime()}`,
      payload: { ...payload },
    });
  }

  /** Tells the holder their PIN changed, so a change they did not make is noticed. */
  private async confirmBySms(account: PinAccount): Promise<void> {
    await this.notify.send({
      destination: account.phoneNumber,
      templateKey: 'pin.set',
      category: 'security',
      locale: account.locale === 'en' ? 'en' : 'sw',
      variables: {},
    });
  }
}

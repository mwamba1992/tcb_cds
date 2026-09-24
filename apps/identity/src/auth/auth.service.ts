import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { isRole, type Role } from '@govsec/auth';
import { IDENTITY_EVENTS, type AccountCreatedPayload } from '@govsec/events';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { OtpService } from './otp.service';
import { normalisePhone } from './phone';
import { PinService } from './pin.service';
import { SessionService, type DeviceContext } from './session.service';
import { StaffAuthService } from './staff-auth.service';
import { TokenService } from './token.service';

export type Locale = 'sw' | 'en';

export interface AuthResult {
  accountId: string;
  role: Role;
  pinSet: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface CodeSent {
  expiresAt: Date;
  resendAfter: Date;
}

/**
 * The investor journeys, in order:
 *
 *   register:  start (phone) → verify (OTP) → signed in → set PIN
 *   sign in:   phone + PIN
 *   forgot:    reset/start (phone) → reset/complete (OTP + new PIN) → signed in
 *
 * Hashing, codes, tokens and sessions live in their own services; this one only
 * sequences them, so each journey reads top to bottom in one place.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly pins: PinService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly staff: StaffAuthService,
  ) {}

  /** Development only: see StaffAuthService. */
  async staffSignIn(input: { username: string; password: string }, device: DeviceContext): Promise<AuthResult> {
    const accountId = await this.staff.verify(input.username, input.password);
    return this.startSession(await this.account(accountId), device);
  }

  /**
   * Send a registration code.
   *
   * A number that already has a PIN is told so, rather than sent a code. That does
   * reveal the number is registered — as every bank's sign-up screen does — and the
   * per-number SMS throttle bounds how fast anyone can ask. The alternative, silently
   * sending a code that cannot be used, strands a customer who forgot they signed up.
   * A number verified earlier but without a PIN simply continues.
   */
  async startRegistration(input: { phoneNumber: string; locale?: Locale }): Promise<CodeSent> {
    const phoneNumber = this.phone(input.phoneNumber);
    const existing = await this.prisma.account.findUnique({
      where: { phoneNumber },
      select: { pinHash: true, locale: true },
    });
    if (existing?.pinHash) {
      throw new AuthError(
        HttpStatus.CONFLICT,
        'phone_already_registered',
        'This number is already registered. Sign in, or reset your PIN.',
      );
    }
    const locale = input.locale ?? (existing?.locale === 'en' ? 'en' : 'sw');
    return this.otp.issue({ phoneNumber, purpose: 'registration', locale });
  }

  /** The OTP proves the phone. The account is created here, never before. */
  async completeRegistration(
    input: { phoneNumber: string; code: string; locale?: Locale },
    device: DeviceContext,
  ): Promise<AuthResult> {
    const phoneNumber = this.phone(input.phoneNumber);
    await this.otp.verify({ phoneNumber, purpose: 'registration', code: input.code });

    const locale = input.locale ?? 'sw';
    const account = await this.prisma.$transaction(async (tx) => {
      const found = await tx.account.findUnique({ where: { phoneNumber } });
      if (found) return found;
      const created = await tx.account.create({
        data: { phoneNumber, phoneVerified: true, locale },
      });
      const payload: AccountCreatedPayload = {
        accountId: created.id,
        role: created.role,
        locale,
        createdAt: created.createdAt.toISOString(),
      };
      await tx.outboxMessage.create({
        data: outboxRow({
          aggregateType: 'account',
          aggregateId: created.id,
          eventType: IDENTITY_EVENTS.accountCreated,
          dedupeKey: created.id,
          payload: { ...payload },
        }),
      });
      return created;
    });

    // Between start and verify someone may have finished registering this number on
    // another device and set a PIN. The OTP proves the phone, but signing in without
    // the PIN would make the OTP alone a way into a funded account.
    if (account.pinHash) {
      throw new AuthError(
        HttpStatus.CONFLICT,
        'phone_already_registered',
        'This number is already registered. Sign in, or reset your PIN.',
      );
    }
    this.assertActive(account.status);
    return this.startSession(account, device);
  }

  async signIn(input: { phoneNumber: string; pin: string }, device: DeviceContext): Promise<AuthResult> {
    const phoneNumber = normalisePhone(input.phoneNumber);
    const account = phoneNumber
      ? await this.prisma.account.findUnique({ where: { phoneNumber } })
      : null;
    if (!account || !account.pinHash) {
      await this.pins.burnTime(input.pin);
      throw this.pins.invalidSignIn();
    }

    await this.pins.verify(account, input.pin, 'sign_in');
    // Checked only after the PIN matched, so it tells nothing the caller did not prove.
    this.assertActive(account.status);

    await this.prisma.account.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });
    return this.startSession(account, device);
  }

  /**
   * Always answers the same way, whether or not the number is registered: unlike
   * sign-up, nothing here helps a genuine customer by saying which it is.
   */
  async startPinReset(input: { phoneNumber: string }): Promise<CodeSent> {
    const phoneNumber = this.phone(input.phoneNumber);
    const account = await this.prisma.account.findUnique({
      where: { phoneNumber },
      select: { pinHash: true, status: true, locale: true },
    });
    if (account?.pinHash && account.status === 'active') {
      return this.otp.issue({
        phoneNumber,
        purpose: 'pin_reset',
        locale: account.locale === 'en' ? 'en' : 'sw',
      });
    }
    const now = Date.now();
    return { expiresAt: new Date(now + 300_000), resendAfter: new Date(now + 60_000) };
  }

  async completePinReset(
    input: { phoneNumber: string; code: string; newPin: string },
    device: DeviceContext,
  ): Promise<AuthResult> {
    const phoneNumber = this.phone(input.phoneNumber);
    // Checked before the code is spent, so a weak choice does not cost the customer
    // their OTP.
    this.pins.assertAcceptable(input.newPin);
    await this.otp.verify({ phoneNumber, purpose: 'pin_reset', code: input.code });

    const account = await this.prisma.account.findUnique({ where: { phoneNumber } });
    if (!account) {
      throw new AuthError(HttpStatus.BAD_REQUEST, 'invalid_code', 'Invalid or expired verification code');
    }
    this.assertActive(account.status);
    await this.pins.reset(account, input.newPin);
    return this.startSession({ ...account, pinHash: 'set' }, device);
  }

  async setPin(accountId: string, pin: string): Promise<void> {
    await this.pins.setInitial(await this.account(accountId), pin);
  }

  async changePin(accountId: string, currentPin: string, newPin: string): Promise<void> {
    await this.pins.change(await this.account(accountId), currentPin, newPin);
  }

  async refresh(refreshToken: string, device: DeviceContext): Promise<AuthResult> {
    const { accountId, sessionId } = await this.sessions.rotate(refreshToken, device);
    const account = await this.account(accountId);
    const role = this.role(account.role);
    const pair = await this.tokens.issuePair({
      accountId,
      role,
      sessionId,
      phoneVerified: account.phoneVerified,
      name: account.displayName,
    });
    await this.sessions.recordRefreshToken(sessionId, pair.refreshToken);
    return { accountId, role, pinSet: account.pinHash !== null, ...pair };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  async profile(accountId: string) {
    const account = await this.account(accountId);
    return {
      accountId: account.id,
      phoneNumber: account.phoneNumber,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      locale: account.locale,
      pinSet: account.pinHash !== null,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
    };
  }

  async setLocale(accountId: string, locale: Locale): Promise<void> {
    await this.prisma.account.update({ where: { id: accountId }, data: { locale } });
  }

  private async startSession(
    account: {
      id: string;
      role: string;
      phoneVerified: boolean;
      pinHash: string | null;
      displayName?: string | null;
    },
    device: DeviceContext,
  ): Promise<AuthResult> {
    const role = this.role(account.role);
    const { sessionId } = await this.sessions.create(account.id, device);
    const pair = await this.tokens.issuePair({
      accountId: account.id,
      role,
      sessionId,
      phoneVerified: account.phoneVerified,
      name: account.displayName ?? null,
    });
    await this.sessions.recordRefreshToken(sessionId, pair.refreshToken);
    return { accountId: account.id, role, pinSet: account.pinHash !== null, ...pair };
  }

  private async account(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  private phone(raw: string): string {
    const phoneNumber = normalisePhone(raw);
    if (!phoneNumber) {
      throw new AuthError(
        HttpStatus.BAD_REQUEST,
        'invalid_phone',
        'Enter a Tanzanian mobile number, e.g. 0712 345 678',
      );
    }
    return phoneNumber;
  }

  private role(value: string): Role {
    if (!isRole(value)) {
      throw new AuthError(HttpStatus.FORBIDDEN, 'account_inactive', 'Account carries an unknown role');
    }
    return value;
  }

  private assertActive(status: string): void {
    if (status !== 'active') {
      throw new AuthError(
        HttpStatus.FORBIDDEN,
        'account_inactive',
        'This account is not active. Call TCB on 0800 780 100.',
      );
    }
  }
}

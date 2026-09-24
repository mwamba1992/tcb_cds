import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { NotifyClient } from '@govsec/notify';
import { CONFIG, type IdentityConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { maskPhone } from './phone';
import { SecretHasher } from './secret-hasher';

export type OtpPurpose = 'registration' | 'pin_reset';

const TEMPLATE: Record<OtpPurpose, string> = {
  registration: 'otp.registration',
  // The sign-in template reads correctly for a reset and warns the holder if it was
  // not them, which is the message a reset needs.
  pin_reset: 'otp.login',
};

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasher,
    private readonly notify: NotifyClient,
    @Inject(CONFIG) private readonly config: IdentityConfig,
  ) {}

  /**
   * Issue a code by SMS. The code is never returned: possessing it has to prove
   * control of the phone.
   *
   * Throttled per number, not per caller: every SMS costs TCB money and lands on a
   * real person's phone, so a script cycling IP addresses must not be able to flood
   * one number or run up the bill.
   */
  async issue(input: {
    phoneNumber: string;
    purpose: OtpPurpose;
    locale: 'sw' | 'en';
  }): Promise<{ expiresAt: Date; resendAfter: Date }> {
    await this.enforceRate(input.phoneNumber);

    // Retire codes still in flight, so an attacker cannot hold several live codes
    // and widen the guess space.
    await this.prisma.otpChallenge.updateMany({
      where: { phoneNumber: input.phoneNumber, purpose: input.purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // randomInt is CSPRNG-backed. The fixed code (development only, refused in
    // production) keeps every other part of the flow real: still hashed, still
    // expiring, still burning attempts.
    const code =
      this.config.otp.fixedCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = Date.now();
    const expiresAt = new Date(now + this.config.otp.ttlSeconds * 1000);

    await this.prisma.otpChallenge.create({
      data: {
        phoneNumber: input.phoneNumber,
        purpose: input.purpose,
        codeHash: await this.hasher.hash(code),
        maxAttempts: this.config.otp.maxAttempts,
        expiresAt,
      },
    });

    // A direct call, never an event: a code in an event payload would hand a live
    // credential to every consumer of the exchange.
    await this.notify.send({
      destination: input.phoneNumber,
      templateKey: TEMPLATE[input.purpose],
      category: 'security',
      locale: input.locale,
      variables: { code, minutes: String(Math.round(this.config.otp.ttlSeconds / 60)) },
    });

    this.logger.log(`OTP issued to ${maskPhone(input.phoneNumber)} (${input.purpose})`);
    if (this.config.otp.fixedCode) {
      this.logger.warn(`OTP_FIXED_CODE is set: every code is ${this.config.otp.fixedCode}. Development only.`);
    }
    return { expiresAt, resendAfter: new Date(now + this.config.otp.resendSeconds * 1000) };
  }

  /**
   * Check and consume a code. Every failure gives the same answer, so a caller cannot
   * tell "no code pending for this number" from "wrong code" from "expired".
   */
  async verify(input: { phoneNumber: string; purpose: OtpPurpose; code: string }): Promise<void> {
    const invalid = new AuthError(
      HttpStatus.BAD_REQUEST,
      'invalid_code',
      'Invalid or expired verification code',
    );

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber: input.phoneNumber, purpose: input.purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw invalid;
    if (challenge.expiresAt.getTime() <= Date.now()) throw invalid;

    // Count the attempt before checking, conditionally on the ceiling, so neither a
    // crash mid-verify nor parallel requests can buy extra guesses.
    const counted = await this.prisma.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: { lt: challenge.maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) throw invalid;

    if (!(await this.hasher.verify(challenge.codeHash, input.code))) throw invalid;

    // Consumed conditionally: two correct submissions racing get one success.
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw invalid;
  }

  private async enforceRate(phoneNumber: string): Promise<void> {
    const now = Date.now();
    const recent = await this.prisma.otpChallenge.findMany({
      where: { phoneNumber, createdAt: { gt: new Date(now - 3_600_000) } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const last = recent[0]?.createdAt.getTime();
    const gapMs = this.config.otp.resendSeconds * 1000;
    if (last !== undefined && now - last < gapMs) {
      const retryAfterSeconds = Math.ceil((last + gapMs - now) / 1000);
      throw new AuthError(
        HttpStatus.TOO_MANY_REQUESTS,
        'otp_too_soon',
        `Wait ${retryAfterSeconds} seconds before requesting another code`,
        { retryAfterSeconds },
      );
    }
    if (recent.length >= this.config.otp.maxPerHour) {
      const oldest = recent[recent.length - 1]?.createdAt.getTime() ?? now;
      throw new AuthError(
        HttpStatus.TOO_MANY_REQUESTS,
        'otp_limit',
        'Too many codes requested for this number; try again later',
        { retryAfterSeconds: Math.ceil((oldest + 3_600_000 - now) / 1000) },
      );
    }
  }
}

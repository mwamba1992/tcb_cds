import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IDENTITY_EVENTS, type LoginSuspiciousPayload } from '@govsec/events';
import { CONFIG, durationMs, type IdentityConfig } from '../config/configuration';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { TokenService } from './token.service';

export interface DeviceContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  /** From the same setting as the refresh token's own exp, so the two cannot drift. */
  private readonly lifetimeMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    @Inject(CONFIG) config: IdentityConfig,
  ) {
    this.lifetimeMs = durationMs(config.jwt.refreshTtl);
  }

  async create(accountId: string, device: DeviceContext): Promise<{ sessionId: string }> {
    const session = await this.prisma.session.create({
      data: {
        accountId,
        // Replaced by recordRefreshToken once the token is signed; signing needs the id.
        refreshTokenHash: `pending:${randomUUID()}`,
        ipAddress: device.ipAddress?.slice(0, 64) ?? null,
        userAgent: device.userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(Date.now() + this.lifetimeMs),
      },
      select: { id: true },
    });
    return { sessionId: session.id };
  }

  async recordRefreshToken(sessionId: string, refreshToken: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { refreshTokenHash: this.tokens.hashRefreshToken(refreshToken) },
    });
  }

  /**
   * Retire the presented refresh token and open its successor.
   *
   * A token whose session was already rotated means someone holds a copy:
   * either a thief used it after the customer refreshed, or the customer is replaying
   * one a thief already burned. Both mean compromise, so every session of the account
   * is revoked.
   */
  async rotate(refreshToken: string, device: DeviceContext): Promise<{ accountId: string; sessionId: string }> {
    const invalid = new AuthError(
      HttpStatus.UNAUTHORIZED,
      'invalid_refresh_token',
      'Invalid or expired refresh token',
    );

    let verified: { accountId: string; sessionId: string };
    try {
      verified = await this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw invalid;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: verified.sessionId },
      include: { account: { select: { status: true, pinLockedAt: true } } },
    });
    if (!session || session.accountId !== verified.accountId) throw invalid;
    if (session.refreshTokenHash !== this.tokens.hashRefreshToken(refreshToken)) throw invalid;
    if (session.expiresAt.getTime() <= Date.now()) throw invalid;

    // Only a rotated token signals a copy. A session revoked by sign-out, lockout or
    // PIN reset is simply over: an app still holding its token is not an attacker,
    // and alerting on it would train staff to ignore the alert.
    if (session.rotatedToId) {
      await this.handleReplay(session.accountId, device);
      throw invalid;
    }
    if (session.revokedAt) throw invalid;
    if (session.account.status !== 'active' || session.account.pinLockedAt) throw invalid;

    const successor = await this.prisma.$transaction(async (tx) => {
      // Conditional retire: two refreshes racing with the same token get one successor.
      const retired = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null, rotatedToId: null },
        data: { revokedAt: new Date() },
      });
      if (retired.count !== 1) return null;
      const next = await tx.session.create({
        data: {
          accountId: session.accountId,
          refreshTokenHash: `pending:${randomUUID()}`,
          ipAddress: device.ipAddress?.slice(0, 64) ?? session.ipAddress,
          userAgent: device.userAgent?.slice(0, 300) ?? session.userAgent,
          expiresAt: new Date(Date.now() + this.lifetimeMs),
        },
        select: { id: true },
      });
      await tx.session.update({ where: { id: session.id }, data: { rotatedToId: next.id } });
      return next;
    });
    if (!successor) throw invalid;

    return { accountId: session.accountId, sessionId: successor.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(accountId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private async handleReplay(accountId: string, device: DeviceContext): Promise<void> {
    this.logger.warn(`Refresh token replay for account ${accountId}; revoking all sessions`);
    const detectedAt = new Date();
    const payload: LoginSuspiciousPayload = {
      accountId,
      reason: 'refresh_token_replay',
      ipAddress: device.ipAddress ?? null,
      detectedAt: detectedAt.toISOString(),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: detectedAt },
      });
      // Same account and second is the same detection: skipDuplicates makes a retry
      // of this path a no-op instead of a second alert (or a 500 on the unique key).
      await tx.outboxMessage.createMany({
        skipDuplicates: true,
        data: outboxRow({
          aggregateType: 'account',
          aggregateId: accountId,
          eventType: IDENTITY_EVENTS.loginSuspicious,
          dedupeKey: `${accountId}:replay:${Math.floor(detectedAt.getTime() / 1000)}`,
          payload: { ...payload },
        }),
      });
    });
  }
}

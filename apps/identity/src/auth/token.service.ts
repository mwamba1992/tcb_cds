import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { Permission, Role } from '@govsec/auth';
import { CONFIG, type IdentityConfig } from '../config/configuration';

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/**
 * Identity is the only service that mints tokens (TAD §10.1).
 *
 * Access and step-up tokens are verified everywhere, so under RS256 they are signed
 * with the private key and other services hold only the public one. Refresh tokens
 * are verified only here and stay on their own symmetric secret, so a leaked access
 * key cannot mint them.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: IdentityConfig,
  ) {}

  private signingKey(secret: string): string {
    return this.config.jwt.algorithm === 'RS256' ? this.config.jwt.privateKey : secret;
  }

  async issuePair(input: {
    accountId: string;
    role: Role;
    sessionId: string;
    phoneVerified: boolean;
  }): Promise<IssuedTokenPair> {
    const { jwt } = this.config;
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          typ: 'access',
          role: input.role,
          sid: input.sessionId,
          phoneVerified: input.phoneVerified,
        },
        {
          subject: input.accountId,
          secret: this.signingKey(jwt.accessSecret),
          algorithm: jwt.algorithm,
          expiresIn: jwt.accessTtl,
          issuer: jwt.issuer,
          audience: jwt.audience,
          jwtid: randomUUID(),
        },
      ),
      this.jwt.signAsync(
        { typ: 'refresh', sid: input.sessionId },
        {
          subject: input.accountId,
          secret: jwt.refreshSecret,
          algorithm: 'HS256',
          expiresIn: jwt.refreshTtl,
          issuer: jwt.issuer,
          audience: jwt.audience,
          jwtid: randomUUID(),
        },
      ),
    ]);
    return { accessToken, refreshToken, expiresIn: jwt.accessTtl };
  }

  /**
   * The `pin_token` sent with a bid. Its jti is a step_up_grants row, and that row —
   * not the token — makes it single-use: a JWT stays valid until it expires however
   * often it is presented.
   */
  async issueStepUp(input: {
    accountId: string;
    grantId: string;
    scope: Permission;
    maxAmountMinor?: bigint;
  }): Promise<{ stepUpToken: string; expiresIn: string }> {
    const { jwt } = this.config;
    const stepUpToken = await this.jwt.signAsync(
      {
        typ: 'step_up',
        scope: input.scope,
        ...(input.maxAmountMinor !== undefined
          ? { maxAmountMinor: input.maxAmountMinor.toString() }
          : {}),
      },
      {
        subject: input.accountId,
        secret: this.signingKey(jwt.stepUpSecret),
        algorithm: jwt.algorithm,
        expiresIn: jwt.stepUpTtl,
        issuer: jwt.issuer,
        audience: jwt.audience,
        jwtid: input.grantId,
      },
    );
    return { stepUpToken, expiresIn: jwt.stepUpTtl };
  }

  async verifyRefresh(token: string): Promise<{ accountId: string; sessionId: string }> {
    const claims = await this.jwt.verifyAsync<{ sub: string; sid: string; typ: string }>(token, {
      secret: this.config.jwt.refreshSecret,
      algorithms: ['HS256'],
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
    });
    if (claims.typ !== 'refresh') throw new Error('Not a refresh token');
    return { accountId: claims.sub, sessionId: claims.sid };
  }

  /**
   * SHA-256, not argon2: a refresh token is 200+ bits of signed random material with
   * no dictionary to slow down, and it is looked up by equality on an index.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

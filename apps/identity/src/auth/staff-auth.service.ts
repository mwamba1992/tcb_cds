import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONFIG, type IdentityConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { SecretHasher } from './secret-hasher';

/**
 * Staff sign-in by username and password: development only.
 *
 * TCB staff will sign in through the bank's own directory (Active Directory or SSO,
 * to be confirmed), which is also where joiners, leavers and password policy live.
 * Until that is connected this stands in, so the back office can be built and shown
 * on real data. loadConfig() refuses to start production with it switched on.
 *
 * Wrong passwords count toward a lockout, reserved before the hash is compared for
 * the same reason as PINs: parallel guesses must not all be evaluated.
 */
@Injectable()
export class StaffAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasher,
    @Inject(CONFIG) private readonly config: IdentityConfig,
  ) {}

  /**
   * Re-confirm a signed-in staff member's password, for a step-up. Wrong answers count
   * toward the same lockout as sign-in.
   */
  async confirm(accountId: string, password: string): Promise<void> {
    if (!this.config.staffPasswordLogin) throw new NotFoundException();
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account?.username) throw new AuthError(HttpStatus.FORBIDDEN, 'invalid_credentials', 'Not a staff account');
    await this.verify(account.username, password);
  }

  /** Returns the account id when the credentials are right. */
  async verify(username: string, password: string): Promise<string> {
    // Not found, not forbidden: a production deployment does not have this endpoint.
    if (!this.config.staffPasswordLogin) throw new NotFoundException();

    const invalid = new AuthError(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Username or password is incorrect');
    const account = await this.prisma.account.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
    if (!account?.passwordHash || account.role === 'investor') {
      this.dummyHash ??= this.hasher.hash('not-a-password');
      await this.hasher.verify(await this.dummyHash, password);
      throw invalid;
    }

    const max = this.config.pin.maxAttempts;
    const reserved = await this.prisma.$queryRaw<{ n: number }[]>`
      UPDATE accounts
         SET password_failed_attempts = password_failed_attempts + 1
       WHERE id = ${account.id}::uuid
         AND password_locked_at IS NULL
         AND password_failed_attempts < ${max}
   RETURNING password_failed_attempts AS n
    `;
    const attempt = reserved[0]?.n;
    if (attempt === undefined) {
      throw new AuthError(HttpStatus.LOCKED, 'pin_locked', 'Account locked after too many wrong passwords. Ask ICT to unlock it.');
    }

    if (await this.hasher.verify(account.passwordHash, password)) {
      await this.prisma.account.update({
        where: { id: account.id },
        data: { passwordFailedAttempts: 0, lastLoginAt: new Date() },
      });
      if (account.status !== 'active') {
        throw new AuthError(HttpStatus.FORBIDDEN, 'account_inactive', 'This staff account is not active');
      }
      return account.id;
    }
    if (attempt >= max) {
      await this.prisma.account.update({ where: { id: account.id }, data: { passwordLockedAt: new Date() } });
    }
    throw invalid;
  }
}

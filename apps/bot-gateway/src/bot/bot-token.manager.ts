import { BOT_PATHS, BOT_TOKEN_LIFETIME_SECONDS } from '@govsec/bot-client';
import { BotApiError, type BotTransport } from './bot-transport';

/**
 * Holds the JWT from POST /api/auth (spec §4).
 *
 * - Renewed at 80% of its lifetime, so a request never goes out on a token about to
 *   expire mid-flight.
 * - Single-flight: when many requests find the token stale at once, they share one
 *   sign-in instead of each starting their own.
 * - `invalidate()` is called on a 401, after which the next request signs in again.
 *
 * The spec issues a refresh token but documents no refresh endpoint (Appendix B, B11),
 * so renewal is a fresh sign-in.
 */
export class BotTokenManager {
  private token: string | null = null;
  private renewAt = 0;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly transport: BotTransport,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getToken(): Promise<string> {
    if (this.token && this.now() < this.renewAt) return this.token;
    this.inFlight ??= this.signIn().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  invalidate(): void {
    this.token = null;
    this.renewAt = 0;
  }

  private async signIn(): Promise<string> {
    const response = await this.transport.send(
      { method: 'POST', path: BOT_PATHS.auth, body: { username: this.transport.username } },
      null,
    );
    const body = (response.body ?? {}) as { accessToken?: unknown; expiresIn?: unknown };
    if (typeof body.accessToken !== 'string' || body.accessToken === '') {
      throw new BotApiError(
        response.status,
        'AUTH_NO_TOKEN',
        'BoT returned no access token',
        BOT_PATHS.auth,
      );
    }
    const lifetime =
      typeof body.expiresIn === 'number' && body.expiresIn > 0
        ? body.expiresIn
        : BOT_TOKEN_LIFETIME_SECONDS;
    this.token = body.accessToken;
    this.renewAt = this.now() + lifetime * 1000 * 0.8;
    return this.token;
  }
}

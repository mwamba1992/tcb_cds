import { BotApiError, type BotRequest, type BotTransport } from './bot-transport';
import type { BotTokenManager } from './bot-token.manager';

export interface RetryOptions {
  /** Attempts after the first, for BoT-side failures and timeouts. */
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Authenticated calls to BoT, with the recovery rules every caller needs:
 *
 * - **401** — the token was refused: sign in again and repeat the request once. A
 *   second 401 is a real credential problem and is raised.
 * - **5xx / unreachable** — retried with exponential back-off. Safe for every call we
 *   make: GETs are reads, a PUT sets the same values again, and a repeated
 *   POST /bids reuses its batch reference, which BoT answers with 409 rather than
 *   accepting twice.
 * - **4xx** — never retried. BoT has told us the request is wrong; repeating it will
 *   not change the answer.
 */
export class BotApiClient {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly transport: BotTransport,
    private readonly tokens: BotTokenManager,
    options: RetryOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 300;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async call(request: BotRequest): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.authenticated(request);
      } catch (error) {
        if (!(error instanceof BotApiError) || !error.retryable || attempt >= this.maxRetries)
          throw error;
        await this.sleep(this.baseDelayMs * 2 ** attempt);
      }
    }
  }

  private async authenticated(request: BotRequest): Promise<unknown> {
    const token = await this.tokens.getToken();
    try {
      return (await this.transport.send(request, token)).body;
    } catch (error) {
      if (error instanceof BotApiError && error.status === 401) {
        this.tokens.invalidate();
        const fresh = await this.tokens.getToken();
        return (await this.transport.send(request, fresh)).body;
      }
      throw error;
    }
  }
}

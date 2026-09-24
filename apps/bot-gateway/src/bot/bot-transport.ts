import { botTimestamp, canonicalString, type RequestSigner } from '@govsec/bot-client';
import { batchReferenceFrom, skewFromDateHeader, type BotExchangeObserver } from './bot-observer';

/**
 * One signed HTTP exchange with the BoT GSS API (spec §2, TAD §7.3).
 *
 * The body is serialised exactly once, and those bytes are both signed and sent.
 * Serialising twice — once to sign, once for the HTTP client — can change key order or
 * whitespace, and BoT then rejects a signature that was correct for a body it never saw.
 */

export interface BotCredentials {
  baseUrl: string;
  apiKey: string;
  interfaceCode: string;
  senderCode: string;
  username: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface BotRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface BotResponse {
  status: number;
  body: unknown;
}

/** A failure talking to BoT, with BoT's own error code where it gave one (spec §10). */
export class BotApiError extends Error {
  constructor(
    /** HTTP status, or 0 when BoT could not be reached at all. */
    readonly status: number,
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'BotApiError';
  }

  /** Worth trying again: BoT was unreachable, timed out, or failed on its side. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface TransportOptions {
  timeoutMs?: number;
  /** Told about every exchange: audit log, health, clock skew. */
  observer?: BotExchangeObserver;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class BotTransport {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly observer: BotExchangeObserver | null;

  constructor(
    private readonly credentials: BotCredentials,
    private readonly signer: RequestSigner,
    options: TransportOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.observer = options.observer ?? null;
  }

  get username(): string {
    return this.credentials.username;
  }

  async send(request: BotRequest, token: string | null): Promise<BotResponse> {
    const target = new URL(request.path + queryString(request.query), this.credentials.baseUrl);
    // Sign the path exactly as it goes on the wire, including any encoding and query.
    const pathAndQuery = `${target.pathname}${target.search}`;
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const timestamp = botTimestamp(this.now());
    const signature = await this.signer.sign(
      canonicalString({ method: request.method, pathAndQuery, timestamp, body }),
    );

    const started = Date.now();
    const report = (status: number, errorCode: string | null, dateHeader: string | null) =>
      this.observer?.onExchange({
        at: new Date(started),
        method: request.method,
        path: target.pathname,
        status,
        durationMs: Date.now() - started,
        errorCode,
        batchReference: batchReferenceFrom(target.pathname),
        clockSkewSeconds: skewFromDateHeader(dateHeader, this.now()),
      });

    let response: Response;
    try {
      response = await this.fetchImpl(target, {
        method: request.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          interface: this.credentials.interfaceCode,
          sender: this.credentials.senderCode,
          'x-api-key': this.credentials.apiKey,
          'x-timestamp': timestamp,
          'x-signature': signature,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === '' ? undefined : body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      report(0, 'NETWORK_ERROR', null);
      throw new BotApiError(0, 'NETWORK_ERROR', `BoT unreachable: ${reason}`, target.pathname);
    }

    const text = await response.text();
    const parsed = parseJson(text);
    const dateHeader = response.headers.get('date');
    if (!response.ok) {
      const detail = (parsed ?? {}) as { code?: unknown; message?: unknown };
      const code = typeof detail.code === 'string' ? detail.code : `HTTP_${response.status}`;
      report(response.status, code, dateHeader);
      throw new BotApiError(
        response.status,
        code,
        typeof detail.message === 'string' ? detail.message : `BoT answered ${response.status}`,
        target.pathname,
      );
    }
    report(response.status, null, dateHeader);
    return { status: response.status, body: parsed };
  }
}

function queryString(query: BotRequest['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

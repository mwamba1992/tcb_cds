import { internalHeaders } from '@govsec/auth';

/** A neighbouring service refused or could not be reached; `body` is its JSON answer. */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'UpstreamError';
  }

  get code(): string | undefined {
    return typeof this.body['code'] === 'string' ? this.body['code'] : undefined;
  }
}

/** JSON over the internal network with the auction service's credential. */
export class InternalHttp {
  constructor(
    private readonly service: string,
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly timeoutMs = 15_000,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PUT', path, body);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: internalHeaders('auction', this.secret),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(this.service, 0, `${this.service} unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      throw new UpstreamError(this.service, response.status, `${this.service} answered ${response.status} on ${path}`, parsed);
    }
    return parsed as T;
  }
}

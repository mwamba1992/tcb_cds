import { internalHeaders } from '@govsec/auth';

/** A neighbouring service failed or could not be reached. */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * JSON over the internal network, with the service credential. Unlike NotifyClient
 * this throws: onboarding cannot decide anything without identity or Core Banking,
 * and pretending otherwise would approve people on missing data.
 */
export class InternalHttp {
  constructor(
    private readonly service: string,
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly timeoutMs = 10_000,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('POST', path, body);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: internalHeaders('investor', this.secret),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(
        this.service,
        0,
        `${this.service} unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new UpstreamError(this.service, response.status, `${this.service} answered ${response.status} on ${path}`);
    }
    return (await response.json()) as T;
  }
}

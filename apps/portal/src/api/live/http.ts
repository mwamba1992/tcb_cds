/**
 * The portal's HTTP client for the live services.
 *
 * Every error becomes an `AccountError` with the server's machine-readable code and a
 * sentence written here, for the customer. Server messages are never shown as they
 * are: they are written for developers, in one language, and can change.
 */

export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail: { retryAfterSeconds?: number; attemptsRemaining?: number; reason?: string } = {},
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export interface TokenSource {
  accessToken(): string | null;
  /** Obtain a new access token; false when the session is over. */
  refresh(): Promise<boolean>;
}

let tokens: TokenSource | null = null;

export function useTokens(source: TokenSource): void {
  tokens = source;
}

export type Service = 'identity' | 'investor';

export async function request<T>(
  service: Service,
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const token = init.auth === false ? null : tokens?.accessToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    return fetch(`/api/${service}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  };

  let response: Response;
  try {
    response = await send();
    // An expired access token: refresh once and retry. A second 401 is final.
    if (response.status === 401 && init.auth !== false && tokens && (await tokens.refresh())) {
      response = await send();
    }
  } catch {
    throw new AccountError('network', 'We could not reach TCB. Check your connection and try again.', 0);
  }

  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw toError(response.status, body);
  return body as T;
}

function toError(status: number, body: Record<string, unknown>): AccountError {
  const code = typeof body['code'] === 'string' ? body['code'] : status === 400 ? 'invalid_input' : `http_${status}`;
  const detail = {
    ...(typeof body['retryAfterSeconds'] === 'number' ? { retryAfterSeconds: body['retryAfterSeconds'] } : {}),
    ...(typeof body['attemptsRemaining'] === 'number' ? { attemptsRemaining: body['attemptsRemaining'] } : {}),
    ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
  };
  return new AccountError(code, messageFor(code, detail, status), status, detail);
}

export function messageFor(code: string, detail: AccountError['detail'], status: number): string {
  switch (code) {
    case 'invalid_phone':
      return 'Enter a Tanzanian mobile number, for example 0712 345 678.';
    case 'phone_already_registered':
      return 'This number is already registered. Sign in, or reset your PIN if you have forgotten it.';
    case 'otp_too_soon':
      return `Please wait ${detail.retryAfterSeconds ?? 60} seconds before asking for another code.`;
    case 'otp_limit':
      return 'Too many codes have been sent to this number. Please try again in an hour.';
    case 'invalid_code':
      return 'That code is wrong or has expired. Check the SMS, or ask for a new code.';
    case 'weak_pin':
      return weakPin(detail.reason);
    case 'invalid_credentials':
      return detail.attemptsRemaining !== undefined
        ? `Wrong PIN. ${detail.attemptsRemaining} ${detail.attemptsRemaining === 1 ? 'try' : 'tries'} left before your account is locked.`
        : 'The phone number or PIN is incorrect.';
    case 'pin_locked':
      return 'Your account is locked after too many wrong PINs. Reset your PIN to continue.';
    case 'account_inactive':
      return 'This account is not active. Please call TCB on 0800 780 100.';
    case 'nida_already_registered':
      return 'This NIDA number is already registered with TCB Government Securities. Please call TCB on 0800 780 100.';
    case 'invalid_nida':
      return 'The NIDA number must have 20 digits.';
    case 'not_editable':
    case 'already_submitted':
      return 'Your application is being reviewed, so your details cannot be changed now.';
    default:
      return status >= 500 || status === 0
        ? 'Something went wrong on our side. Please try again in a moment.'
        : 'Please check the details and try again.';
  }
}

function weakPin(reason: string | undefined): string {
  switch (reason) {
    case 'repeated':
      return 'Choose a PIN that is not one digit repeated, like 1111.';
    case 'sequential':
      return 'Choose a PIN that is not a run of digits, like 1234 or 9876.';
    case 'common':
      return 'That PIN is used by many people. Choose a less obvious one.';
    default:
      return 'Your PIN must be 4 digits.';
  }
}

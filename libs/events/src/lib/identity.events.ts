/**
 * Events identity publishes on the `govsec.identity` exchange (TAD §7.5).
 *
 * Payloads carry the opaque account id and never a phone number or credential: every
 * consumer bound to the exchange sees every field. A service that needs to reach the
 * person asks identity for contact details over the internal API.
 */

export const IDENTITY_EVENTS = {
  /** A phone number was proved by OTP and an investor account now exists. */
  accountCreated: 'identity.account.created',
  /** The transaction PIN was set for the first time or reset. */
  pinSet: 'identity.pin.set',
  /** Too many wrong PINs: sessions revoked until the holder resets the PIN by OTP. */
  accountLocked: 'identity.account.locked',
  /** A retired refresh token was presented; every session was revoked. */
  loginSuspicious: 'identity.login.suspicious',
} as const;

export type IdentityEventType = (typeof IDENTITY_EVENTS)[keyof typeof IDENTITY_EVENTS];

export interface AccountCreatedPayload {
  accountId: string;
  role: string;
  locale: 'sw' | 'en';
  createdAt: string;
}

export interface PinSetPayload {
  accountId: string;
  reason: 'initial' | 'change' | 'reset';
  at: string;
}

export interface AccountLockedPayload {
  accountId: string;
  failedAttempts: number;
  lockedAt: string;
}

export interface LoginSuspiciousPayload {
  accountId: string;
  reason: 'refresh_token_replay';
  ipAddress: string | null;
  detectedAt: string;
}

import type { Permission, Role } from './roles';

/** Discriminator carried by every GovSec token so one kind cannot be used as another. */
export type TokenType = 'access' | 'refresh' | 'step_up';

interface BaseClaims {
  /** Account id. */
  sub: string;
  typ: TokenType;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AccessTokenClaims extends BaseClaims {
  typ: 'access';
  role: Role;
  /** Session id, so revoking a session invalidates its refresh chain. */
  sid: string;
  phoneVerified: boolean;
  /** Staff only: the name recorded against their decisions. */
  name?: string;
}

export interface RefreshTokenClaims extends BaseClaims {
  typ: 'refresh';
  sid: string;
}

/**
 * The step-up token sent as `pin_token` when a bid is placed or a batch approved.
 *
 * It is scoped to a single action and optionally to an amount ceiling. Without the
 * scope, a step-up captured to view a statement would authorise a 50,000,000 TZS
 * bid — the token would prove "this person knows the PIN", which is not the
 * same claim as "this person approved this transaction".
 */
export interface StepUpTokenClaims extends BaseClaims {
  typ: 'step_up';
  scope: Permission;
  /** Ceiling in minor units, serialised as a string to survive JSON. */
  maxAmountMinor?: string;
}

export type GovsecTokenClaims = AccessTokenClaims | RefreshTokenClaims | StepUpTokenClaims;

/** The authenticated principal attached to a request by JwtAuthGuard. */
export interface AuthenticatedUser {
  accountId: string;
  role: Role;
  sessionId: string;
  phoneVerified: boolean;
  permissions: readonly Permission[];
  /** Staff only. */
  name?: string;
}

export function isAccessTokenClaims(claims: GovsecTokenClaims): claims is AccessTokenClaims {
  return claims.typ === 'access';
}

export function isRefreshTokenClaims(claims: GovsecTokenClaims): claims is RefreshTokenClaims {
  return claims.typ === 'refresh';
}

export function isStepUpTokenClaims(claims: GovsecTokenClaims): claims is StepUpTokenClaims {
  return claims.typ === 'step_up';
}

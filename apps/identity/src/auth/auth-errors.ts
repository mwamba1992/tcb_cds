import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Errors the portal acts on carry a machine-readable `code` beside the message: the
 * portal shows its own bilingual text and never a server string, so without a code
 * every 401 would read as "wrong PIN".
 */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_code'
  | 'pin_locked'
  | 'pin_not_set'
  | 'pin_already_set'
  | 'weak_pin'
  | 'phone_already_registered'
  | 'otp_too_soon'
  | 'otp_limit'
  | 'account_inactive'
  | 'invalid_phone'
  | 'invalid_refresh_token'
  | 'action_not_permitted'
  | 'step_up_refused';

export class AuthError extends HttpException {
  constructor(status: HttpStatus, code: AuthErrorCode, message: string, extra: object = {}) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}

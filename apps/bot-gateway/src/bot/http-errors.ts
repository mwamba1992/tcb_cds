import { HttpException, HttpStatus } from '@nestjs/common';
import { BotApiError } from './bot-transport';
import { BotValidationError } from './bot.service';

/**
 * BoT's answers, mapped for the internal caller.
 *
 * Our own validation and BoT's 4xx are the request's fault: 422, or 409 for a cut-off
 * or duplicate. BoT being down, or refusing our credentials, is not the caller's fault:
 * 502, which it may retry.
 */
export function toHttp(error: unknown): HttpException {
  if (error instanceof BotValidationError) {
    return new HttpException(
      { code: 'INVALID_REQUEST', message: error.message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (error instanceof BotApiError) {
    const body = { code: error.code, message: error.message, botStatus: error.status };
    if (error.status === 409) return new HttpException(body, HttpStatus.CONFLICT);
    if (error.status >= 400 && error.status < 500 && error.status !== 401) {
      return new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return new HttpException(body, HttpStatus.BAD_GATEWAY);
  }
  if (error instanceof HttpException) return error;
  return new HttpException(
    { code: 'INTERNAL', message: 'BoT request failed' },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const INTERNAL_CALLER_KEY = 'govsec:internalCaller';

/**
 * Restricts an internal endpoint to named calling services.
 *
 * `@InternalOnly('settlement')` on a funds-movement endpoint means that even a service
 * holding the shared secret identifies as itself and is refused unless it is named.
 */
export const InternalOnly = (...services: string[]) => SetMetadata(INTERNAL_CALLER_KEY, services);

export interface ServiceAuthOptions {
  /** This service's own name, for logging and for the caller's benefit. */
  serviceName: string;
  /** Shared secret. Production replaces this with mTLS + service JWTs (TAD §10.1). */
  secret: string;
}

export const SERVICE_AUTH_OPTIONS = 'GOVSEC_SERVICE_AUTH_OPTIONS';

/**
 * Authenticates service-to-service calls.
 *
 * Two headers, deliberately: `x-internal-secret` proves the caller is inside the
 * mesh, and `x-internal-service` says who it claims to be. Only the first is a
 * credential — the second is an assertion the shared-secret model cannot verify, and
 * that honesty matters. It stops a *misrouted* internal call, not a malicious one
 * with the secret in hand.
 *
 * That is why the constraint is also enforced at build time by
 * @nx/enforce-module-boundaries, which no runtime credential can bypass: only code
 * carrying the right `domain:` tag can even import the client that calls such an endpoint.
 * Production tightens the runtime half with mTLS, where the caller's identity is its
 * certificate rather than a header it chooses.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly options: ServiceAuthOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // A message off a queue has no HTTP request, and no caller to authenticate — it was
    // authorised when it was published. Applying an HTTP guard to it is a category
    // error, and reading request.headers on a non-HTTP context throws.
    //
    // This surfaced the moment the platform gained its first event consumer: the guards
    // are registered as APP_GUARD, and @RabbitSubscribe handlers run through the same
    // pipeline.
    if (context.getType() !== 'http') return true;

    const allowed = this.reflector.getAllAndOverride<string[]>(INTERNAL_CALLER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const secret = request.headers['x-internal-secret'];
    const caller = request.headers['x-internal-service'];

    if (typeof secret !== 'string' || !constantTimeEquals(secret, this.options.secret)) {
      throw new ForbiddenException('Internal endpoint');
    }
    if (typeof caller !== 'string' || !allowed.includes(caller)) {
      throw new ForbiddenException(`This endpoint accepts calls from ${allowed.join(', ')} only`);
    }
    return true;
  }
}

/** Compares without leaking the answer through how long it took. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Headers a caller must send to satisfy ServiceAuthGuard. */
export function internalHeaders(serviceName: string, secret: string): Record<string, string> {
  return {
    'x-internal-service': serviceName,
    'x-internal-secret': secret,
    'content-type': 'application/json',
  };
}

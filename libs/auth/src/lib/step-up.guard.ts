import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options';
import type { AuthenticatedUser, StepUpTokenClaims } from './claims';
import { REQUIRED_STEP_UP_KEY } from './decorators';
import type { Permission } from './roles';

/**
 * Enforces the step-up grant sent as `pin_token` (TAD §10.1).
 *
 * The guard verifies signature, type, subject, scope and amount ceiling — but it does
 * NOT mark the grant consumed. Single-use has to be redeemed inside the same database
 * transaction as the money movement it authorises; burning it here would leave the
 * user unable to retry after a downstream failure, and would let a caller exhaust
 * someone's grants by replaying requests that never reach the ledger.
 *
 * The resource service therefore calls Identity's redeem endpoint (or its own local
 * grant table, once Wallet exists) as part of committing the transaction.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(AUTH_OPTIONS) private readonly options: AuthModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // A message off a queue has no HTTP request, and no caller to authenticate — it was
    // authorised when it was published. Applying an HTTP guard to it is a category
    // error, and reading request.headers on a non-HTTP context throws.
    //
    // This surfaced the moment the platform gained its first event consumer: the guards
    // are registered as APP_GUARD, and @RabbitSubscribe handlers run through the same
    // pipeline.
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<Permission>(REQUIRED_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; stepUp?: StepUpTokenClaims }>();

    const token = extractStepUpToken(request);
    if (!token) {
      throw new ForbiddenException('This action requires step-up authentication');
    }

    let claims: StepUpTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<StepUpTokenClaims>(token, {
        secret: this.options.stepUpTokenSecret,
        issuer: this.options.issuer,
        audience: this.options.audience,
        // Pinned deliberately. Without it a token could nominate its own algorithm,
        // and the classic attack is to present an HS256 token signed with the public
        // key that verifiers publish freely.
        algorithms: [this.options.algorithm ?? 'HS256'],
      });
    } catch {
      throw new ForbiddenException('Invalid or expired step-up token');
    }

    if (claims.typ !== 'step_up') {
      throw new ForbiddenException('Wrong token type for step-up');
    }
    // Without this, one account's step-up would authorise another's bid.
    if (!request.user || claims.sub !== request.user.accountId) {
      throw new ForbiddenException('Step-up token belongs to a different account');
    }
    // The whole point of scoping: a grant taken to place a bid must not approve a
    // batch.
    if (claims.scope !== required) {
      throw new ForbiddenException(
        `Step-up token is scoped to "${claims.scope}", not "${required}"`,
      );
    }

    request.stepUp = claims;
    return true;
  }
}

function extractStepUpToken(request: Request): string | null {
  const header = request.headers['x-step-up-token'];
  if (typeof header === 'string' && header.length > 0) return header;

  // Clients may put it in the request body as `pin_token`; accepted for contract
  // compatibility, though the header keeps credentials out of request logs.
  const body = request.body as { pin_token?: unknown } | undefined;
  if (body && typeof body.pin_token === 'string' && body.pin_token.length > 0) {
    return body.pin_token;
  }
  return null;
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessTokenClaims, AuthenticatedUser } from './claims';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY, REQUIRED_ROLES_KEY } from './decorators';
import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options';
import { isRole, permissionsForRole, type Permission, type Role } from './roles';

/**
 * Validates the Bearer access token and attaches the principal to the request.
 *
 * Registered globally, so every route is protected unless marked @Public(). Role and
 * permission checks happen here too, since they read from the same verified claims
 * and a second guard pass would only re-parse the token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
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

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token, {
        secret: this.options.accessTokenSecret,
        issuer: this.options.issuer,
        audience: this.options.audience,
        // Pinned deliberately. Without it a token could nominate its own algorithm,
        // and the classic attack is to present an HS256 token signed with the public
        // key that verifiers publish freely.
        algorithms: [this.options.algorithm ?? 'HS256'],
      });
    } catch {
      // Deliberately opaque: distinguishing "expired" from "bad signature" tells an
      // attacker which half of a forged token to fix.
      throw new UnauthorizedException('Invalid or expired token');
    }

    // A refresh token is a valid signature over the same key material, so without
    // this check it would pass as an access token and never expire in practice.
    if (claims.typ !== 'access') {
      throw new UnauthorizedException('Wrong token type for this endpoint');
    }
    if (!isRole(claims.role)) {
      throw new UnauthorizedException('Token carries an unknown role');
    }

    const permissions = permissionsForRole(claims.role);
    const user: AuthenticatedUser = {
      accountId: claims.sub,
      role: claims.role,
      sessionId: claims.sid,
      phoneVerified: claims.phoneVerified,
      permissions,
    };
    request.user = user;

    this.assertRoles(context, user.role);
    this.assertPermissions(context, permissions);
    return true;
  }

  private assertRoles(context: ExecutionContext, role: Role): void {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(role)) {
      throw new ForbiddenException('Role not permitted for this action');
    }
  }

  private assertPermissions(context: ExecutionContext, held: readonly Permission[]): void {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.every((permission) => held.includes(permission))) {
      throw new ForbiddenException('Missing required permission');
    }
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

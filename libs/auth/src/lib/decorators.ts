import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedUser } from './claims';
import type { Permission, Role } from './roles';

export const IS_PUBLIC_KEY = 'govsec:isPublic';
export const REQUIRED_ROLES_KEY = 'govsec:requiredRoles';
export const REQUIRED_PERMISSIONS_KEY = 'govsec:requiredPermissions';
export const REQUIRED_STEP_UP_KEY = 'govsec:requiredStepUp';

/**
 * Marks a route as reachable without an access token.
 *
 * Guards are registered globally and deny by default, so a new endpoint is protected
 * unless someone explicitly opts out here. The reverse default — open unless
 * annotated — leaks an endpoint every time somebody forgets.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Demands a valid step-up grant scoped to `permission`, on top of the normal access
 * token (TAD §10.1). Apply to bid placement, batch approval and PIN changes.
 */
export const RequireStepUp = (permission: Permission) =>
  SetMetadata(REQUIRED_STEP_UP_KEY, permission);

/**
 * The verified step-up claims that StepUpGuard attached, on a route annotated
 * @RequireStepUp. `jti` is the grant id the resource service redeems.
 */
export const StepUp = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ stepUp?: unknown }>();
  return request.stepUp;
});

export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

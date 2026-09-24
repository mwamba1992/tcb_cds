import type { AuthenticatedUser } from '@govsec/auth';

/** One admin_actions row. Written in the same transaction as the change it records. */
export function adminAction(
  actor: AuthenticatedUser,
  action: string,
  targetId: string,
  extra: { detail?: string; reason?: string } = {},
) {
  return {
    actorId: actor.accountId,
    actorName: actor.name ?? null,
    actorRole: actor.role,
    action,
    targetId,
    detail: extra.detail?.slice(0, 200) ?? null,
    reason: extra.reason?.slice(0, 500) ?? null,
  };
}

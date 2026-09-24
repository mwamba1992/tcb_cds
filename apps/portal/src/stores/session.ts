import type { Permission } from '@govsec/auth/roles';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { isRole, permissionsForRole, ROLES, type Role } from '@govsec/auth/roles';
import { HAS_INVESTOR, HAS_STAFF, LIVE_AUTH } from '../config/portal';
import { PERSONAS, type StaffPersona } from '../config/personas';
import type { SessionUser } from '../api/types';
import { useAccountStore } from './account';

export type Portal = 'investor' | 'staff';

const ROLE_LABELS: Record<Role, string> = {
  investor: 'Individual investor',
  ops_officer: 'Operations · Maker',
  ops_supervisor: 'Operations · Checker',
  treasury_officer: 'Treasury · Settlement',
  compliance_officer: 'Compliance',
  bot_observer: 'Bank of Tanzania',
  system_admin: 'ICT administrator',
};

/**
 * Who is signed in, and to which portal.
 *
 * Sign-in is mocked: the portal starts as the persona for its build. In production
 * the user comes from the identity service's token, and `setPortal`/`actAs` do not
 * exist in the UI (they are demo controls).
 */
export const useSessionStore = defineStore('session', () => {
  const portal = ref<Portal>(HAS_INVESTOR ? 'investor' : 'staff');
  const staffPersona = ref<StaffPersona>('checker');

  const account = useAccountStore();

  const user = computed<SessionUser>(() => {
    if (!LIVE_AUTH) return portal.value === 'investor' ? PERSONAS.investor : PERSONAS[staffPersona.value];
    const name = account.displayName;
    const parts = name.split(' ').filter((p) => /[A-Za-z]/.test(p));
    const role = account.me && isRole(account.me.role) ? account.me.role : ROLES.investor;
    return {
      id: account.me?.accountId ?? '',
      name,
      initials: `${parts[0]?.charAt(0) ?? ''}${parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : ''}`,
      role,
      roleLabel: ROLE_LABELS[role],
      // Nothing is permitted until the session has loaded: a screen must not render
      // actions for a role the user may not hold.
      permissions: account.me ? permissionsForRole(role) : [],
    };
  });

  function can(permission: Permission): boolean {
    return user.value.permissions.includes(permission);
  }

  function setPortal(next: Portal) {
    if ((next === 'investor' && HAS_INVESTOR) || (next === 'staff' && HAS_STAFF)) {
      portal.value = next;
    }
  }

  function actAs(next: StaffPersona) {
    staffPersona.value = next;
  }

  return { portal, staffPersona, user, can, setPortal, actAs };
});

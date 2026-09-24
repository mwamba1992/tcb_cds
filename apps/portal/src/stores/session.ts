import type { Permission } from '@govsec/auth/roles';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { permissionsForRole, ROLES } from '@govsec/auth/roles';
import { HAS_INVESTOR, HAS_STAFF, LIVE_AUTH } from '../config/portal';
import { PERSONAS, type StaffPersona } from '../config/personas';
import type { SessionUser } from '../api/types';
import { useAccountStore } from './account';

export type Portal = 'investor' | 'staff';

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
    if (portal.value !== 'investor') return PERSONAS[staffPersona.value];
    if (!LIVE_AUTH) return PERSONAS.investor;
    const name = account.displayName;
    const parts = name.split(' ').filter((p) => /[A-Za-z]/.test(p));
    return {
      id: account.me?.accountId ?? '',
      name,
      initials: `${parts[0]?.charAt(0) ?? ''}${parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : ''}`,
      role: ROLES.investor,
      roleLabel: 'Individual investor',
      permissions: permissionsForRole(ROLES.investor),
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

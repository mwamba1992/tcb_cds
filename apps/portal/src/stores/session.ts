import type { Permission } from '@govsec/auth/roles';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { HAS_INVESTOR, HAS_STAFF } from '../config/portal';
import { PERSONAS, type StaffPersona } from '../config/personas';

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

  const user = computed(() =>
    portal.value === 'investor' ? PERSONAS.investor : PERSONAS[staffPersona.value],
  );

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

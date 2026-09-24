import type { Permission } from '@govsec/auth/roles';
import { createRouter, createWebHistory } from 'vue-router';
import { HAS_INVESTOR, LIVE_AUTH } from '../config/portal';
import { useAccountStore } from '../stores/account';
import { useSessionStore, type Portal } from '../stores/session';
import { investorRoutes } from './investor-routes';
import { staffRoutes } from './staff-routes';

declare module 'vue-router' {
  interface RouteMeta {
    portal?: Portal;
    title?: string;
    /** Required to see the screen at all. Actions check their own permissions too. */
    permission?: Permission;
    /** Allowed with any one of these, for a screen whose tabs serve different roles. */
    anyPermission?: Permission[];
    nav?: { label: string; icon: string; order: number };
    /** Highlights a parent nav item on a child screen (the bid form → Auctions). */
    navParent?: string;
    /** Rendered outside the shell (sign-in, registration). */
    layout?: 'auth';
    /** Reachable without signing in. */
    public?: boolean;
    /** Only once onboarding is complete: KYC approved, CDS and TCB accounts in place. */
    needsBidding?: boolean;
  }
}

const home = (portal: Portal) => ({
  name: portal === 'staff' ? 'staff-overview' : 'investor-dashboard',
});

/**
 * The first screen in the sidebar this user may open. An ICT administrator, say, has
 * no overview; sending them there would show a screen whose data they cannot load.
 */
export function landingFor(portal: Portal): { name: string } {
  const session = useSessionStore();
  const allowed = router
    .getRoutes()
    .filter((r) => r.meta.nav && r.meta.portal === portal)
    .filter((r) => !r.meta.permission || session.can(r.meta.permission))
    .filter((r) => !r.meta.anyPermission || r.meta.anyPermission.some((p) => session.can(p)))
    .sort((a, b) => (a.meta.nav?.order ?? 0) - (b.meta.nav?.order ?? 0));
  return allowed[0]?.name ? { name: allowed[0].name as string } : home(portal);
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...investorRoutes,
    ...staffRoutes,
    { path: '/:pathMatch(.*)*', redirect: () => home(HAS_INVESTOR ? 'investor' : 'staff') },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * A screen belongs to one portal and may need a permission. Anything else goes home,
 * rather than rendering a screen whose every action the server would refuse.
 */
router.beforeEach(async (to) => {
  const session = useSessionStore();

  // Live sign-in: every screen needs a session of the right kind. An investor session
  // cannot open the back office, nor a staff session the investor portal; either is
  // sent to the other portal's sign-in, which replaces the session.
  if (LIVE_AUTH && to.meta.portal) {
    const account = useAccountStore();
    await account.restore();
    const staff = to.meta.portal === 'staff';
    const holds = account.signedIn && (staff ? account.isStaff : account.isInvestor);
    const signIn = staff ? 'staff-sign-in' : 'account-sign-in';
    if (to.meta.public) {
      if (holds) return landingFor(to.meta.portal);
    } else if (!holds) {
      const next = to.fullPath === '/invest' || to.fullPath === '/ops' ? {} : { next: to.fullPath };
      if (session.portal !== to.meta.portal) session.setPortal(to.meta.portal);
      return { name: signIn, query: next };
    } else if (to.meta.needsBidding && !account.onboarding?.canBid) {
      return { name: 'investor-onboarding' };
    }
  }

  if (to.meta.portal && to.meta.portal !== session.portal) {
    session.setPortal(to.meta.portal);
    if (session.portal !== to.meta.portal) return home(session.portal);
  }
  const denied =
    (to.meta.permission && !session.can(to.meta.permission)) ||
    (to.meta.anyPermission && !to.meta.anyPermission.some((p) => session.can(p)));
  if (denied) {
    const fallback = landingFor(session.portal);
    return to.name === fallback.name ? true : fallback;
  }
  return true;
});

export default router;

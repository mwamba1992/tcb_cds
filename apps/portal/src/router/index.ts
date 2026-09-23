import type { Permission } from '@govsec/auth/roles';
import { createRouter, createWebHistory } from 'vue-router';
import { HAS_INVESTOR } from '../config/portal';
import { useSessionStore, type Portal } from '../stores/session';
import { investorRoutes } from './investor-routes';
import { staffRoutes } from './staff-routes';

declare module 'vue-router' {
  interface RouteMeta {
    portal?: Portal;
    title?: string;
    /** Required to see the screen at all. Actions check their own permissions too. */
    permission?: Permission;
    nav?: { label: string; icon: string; order: number };
    /** Highlights a parent nav item on a child screen (the bid form → Auctions). */
    navParent?: string;
  }
}

const home = (portal: Portal) => ({
  name: portal === 'staff' ? 'staff-overview' : 'investor-dashboard',
});

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
router.beforeEach((to) => {
  const session = useSessionStore();
  if (to.meta.portal && to.meta.portal !== session.portal) {
    session.setPortal(to.meta.portal);
    if (session.portal !== to.meta.portal) return home(session.portal);
  }
  if (to.meta.permission && !session.can(to.meta.permission)) {
    const fallback = home(session.portal);
    return to.name === fallback.name ? true : fallback;
  }
  return true;
});

export default router;

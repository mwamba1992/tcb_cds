import { PERMISSIONS } from '@govsec/auth/roles';
import type { RouteRecordRaw } from 'vue-router';

/**
 * Investor routes.
 *
 * In the staff build, vite.config.mts aliases this module to ./investor-routes.none.ts,
 * so the internal site carries no investor screens either.
 */
export const investorRoutes: RouteRecordRaw[] = [
  // Sign-in and registration live with the investor routes, so the staff site has none.
  {
    path: '/login',
    name: 'account-sign-in',
    component: () => import('../views/account/SignInView.vue'),
    meta: { portal: 'investor', layout: 'auth', public: true, title: 'Sign in' },
  },
  {
    path: '/register',
    name: 'account-register',
    component: () => import('../views/account/RegisterView.vue'),
    meta: { portal: 'investor', layout: 'auth', public: true, title: 'Create account' },
  },
  {
    path: '/reset-pin',
    name: 'account-reset-pin',
    component: () => import('../views/account/ResetPinView.vue'),
    meta: { portal: 'investor', layout: 'auth', public: true, title: 'Reset PIN' },
  },
  {
    path: '/invest/onboarding',
    name: 'investor-onboarding',
    component: () => import('../views/investor/OnboardingView.vue'),
    meta: { portal: 'investor', title: 'Your account' },
  },
  {
    path: '/invest',
    name: 'investor-dashboard',
    component: () => import('../views/investor/DashboardView.vue'),
    meta: {
      portal: 'investor',
      title: 'Dashboard',
      nav: { label: 'Dashboard', icon: 'dashboard', order: 1 },
    },
  },
  {
    path: '/invest/auctions',
    name: 'investor-auctions',
    component: () => import('../views/investor/AuctionsView.vue'),
    meta: {
      portal: 'investor',
      title: 'Auctions',
      permission: PERMISSIONS.auctionRead,
      nav: { label: 'Auctions', icon: 'auctions', order: 2 },
    },
  },
  {
    path: '/invest/auctions/:auctionId/bid',
    name: 'investor-bid',
    component: () => import('../views/investor/PlaceBidView.vue'),
    props: true,
    meta: {
      portal: 'investor',
      title: 'Place a bid',
      permission: PERMISSIONS.bidPlace,
      needsBidding: true,
      navParent: 'investor-auctions',
    },
  },
  {
    path: '/invest/bids',
    name: 'investor-bids',
    component: () => import('../views/investor/MyBidsView.vue'),
    meta: {
      portal: 'investor',
      title: 'My bids',
      permission: PERMISSIONS.bidReadOwn,
      nav: { label: 'My bids', icon: 'bids', order: 3 },
    },
  },
];

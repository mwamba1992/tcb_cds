import { PERMISSIONS } from '@govsec/auth/roles';
import type { RouteRecordRaw } from 'vue-router';

/**
 * Investor routes.
 *
 * In the staff build, vite.config.mts aliases this module to ./investor-routes.none.ts,
 * so the internal site carries no investor screens either.
 */
export const investorRoutes: RouteRecordRaw[] = [
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

import { PERMISSIONS } from '@govsec/auth/roles';
import type { RouteRecordRaw } from 'vue-router';

/**
 * Back-office routes.
 *
 * In the investor build, vite.config.mts aliases this module to ./staff-routes.none.ts.
 * Hiding the routes at runtime is not enough: a bundler emits a chunk for every
 * `import()` it sees, reachable or not, and the public server would then host the
 * back-office views for anyone who guessed a file name.
 */
export const staffRoutes: RouteRecordRaw[] = [
  {
    path: '/ops',
    name: 'staff-overview',
    component: () => import('../views/staff/OverviewView.vue'),
    meta: {
      portal: 'staff',
      title: 'Overview',
      permission: PERMISSIONS.reportRead,
      nav: { label: 'Overview', icon: 'dashboard', order: 1 },
    },
  },
  {
    path: '/ops/kyc',
    name: 'staff-kyc',
    component: () => import('../views/staff/KycView.vue'),
    meta: {
      portal: 'staff',
      title: 'KYC exceptions',
      permission: PERMISSIONS.kycReview,
      nav: { label: 'KYC exceptions', icon: 'kyc', order: 2 },
    },
  },
  {
    path: '/ops/submission',
    name: 'staff-submission',
    component: () => import('../views/staff/SubmissionView.vue'),
    meta: {
      portal: 'staff',
      title: 'Bid submission',
      permission: PERMISSIONS.bidReadAll,
      nav: { label: 'Bid submission', icon: 'submit', order: 3 },
    },
  },
  {
    path: '/ops/reconciliation',
    name: 'staff-recon',
    component: () => import('../views/staff/ReconciliationView.vue'),
    meta: {
      portal: 'staff',
      title: 'Settlement reconciliation',
      permission: PERMISSIONS.settlementRead,
      nav: { label: 'Reconciliation', icon: 'recon', order: 4 },
    },
  },
];

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
    path: '/ops/login',
    name: 'staff-sign-in',
    component: () => import('../views/staff/StaffSignInView.vue'),
    meta: { portal: 'staff', layout: 'auth', public: true, title: 'Back-office sign in' },
  },
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
    path: '/ops/customers',
    name: 'staff-customers',
    component: () => import('../views/staff/CustomersView.vue'),
    meta: {
      portal: 'staff',
      title: 'Customers',
      permission: PERMISSIONS.investorRead,
      nav: { label: 'Customers', icon: 'customers', order: 1.5 },
    },
  },
  {
    path: '/ops/customers/:reference',
    name: 'staff-customer',
    component: () => import('../views/staff/CustomerDetailView.vue'),
    props: true,
    meta: { portal: 'staff', title: 'Customer', permission: PERMISSIONS.investorRead, navParent: 'staff-customers' },
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
    path: '/ops/cds',
    name: 'staff-cds',
    component: () => import('../views/staff/CdsView.vue'),
    meta: {
      portal: 'staff',
      title: 'CDS accounts',
      permission: PERMISSIONS.cdsOpen,
      nav: { label: 'CDS accounts', icon: 'cds', order: 2.5 },
    },
  },
  {
    path: '/ops/bank-accounts',
    name: 'staff-bank-accounts',
    component: () => import('../views/staff/BankAccountsView.vue'),
    meta: {
      portal: 'staff',
      title: 'TCB accounts',
      permission: PERMISSIONS.investorRead,
      nav: { label: 'TCB accounts', icon: 'bank', order: 2.7 },
    },
  },
  {
    path: '/ops/users',
    name: 'staff-users',
    component: () => import('../views/staff/UsersView.vue'),
    meta: {
      portal: 'staff',
      title: 'User accounts',
      anyPermission: [PERMISSIONS.adminUserManage, PERMISSIONS.customerLoginRead],
      nav: { label: 'User accounts', icon: 'users', order: 5 },
    },
  },
  {
    path: '/ops/users/customers/:id',
    name: 'staff-customer-login',
    component: () => import('../views/staff/CustomerLoginView.vue'),
    props: true,
    meta: { portal: 'staff', title: 'Customer login', permission: PERMISSIONS.customerLoginRead, navParent: 'staff-users' },
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

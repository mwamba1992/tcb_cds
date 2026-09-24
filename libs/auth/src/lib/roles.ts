/**
 * Roles and permissions (TAD §10.1, RBAC with maker-checker).
 *
 * This map lives in a shared library rather than inside Identity because every
 * service enforces against it locally. Identity stamps the role into the access
 * token; each service resolves that role to permissions itself, so a request is
 * authorised without a network hop back to Identity on every call.
 */

export const ROLES = {
  /** Retail, corporate or institutional investor using the customer portal. */
  investor: 'investor',
  /** TCB operations officer: reviews KYC, prepares BoT submissions (maker). */
  opsOfficer: 'ops_officer',
  /** TCB operations supervisor: approves what an officer prepared (checker). */
  opsSupervisor: 'ops_supervisor',
  /** TCB treasury: settlement and reconciliation. */
  treasuryOfficer: 'treasury_officer',
  /** TCB compliance: KYC decisions, screening, audit. */
  complianceOfficer: 'compliance_officer',
  /** Bank of Tanzania officer on the oversight view. Read-only by construction. */
  botObserver: 'bot_observer',
  /** TCB ICT: users and settings. Deliberately cannot touch money or bids. */
  systemAdmin: 'system_admin',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/**
 * Permissions are `<domain>:<action>` strings. Money-moving ones are marked in
 * STEP_UP_REQUIRED below: holding the permission is necessary but not sufficient.
 */
export const PERMISSIONS = {
  // auctions and bids — investor side
  auctionRead: 'auction:read',
  bidPlace: 'bid:place',
  bidReadOwn: 'bid:read:own',
  bidAmendOwn: 'bid:amend:own',
  portfolioReadOwn: 'portfolio:read:own',
  // KYC
  kycReview: 'kyc:review',
  kycDecide: 'kyc:decide',
  /** Record the CDS account opened for an approved investor. */
  cdsOpen: 'cds:open',
  // auction operations — maker and checker are separate permissions on purpose
  auctionManage: 'auction:manage',
  bidReadAll: 'bid:read:all',
  batchPrepare: 'batch:prepare',
  batchApprove: 'batch:approve',
  // settlement
  settlementRead: 'settlement:read',
  settlementReconcile: 'settlement:reconcile',
  settlementApprove: 'settlement:approve',
  // reporting and oversight
  reportRead: 'report:read',
  oversightRead: 'oversight:read',
  auditRead: 'audit:read',
  // administration
  adminUserManage: 'admin:user:manage',
  adminSettingsManage: 'admin:settings:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const INVESTOR_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.auctionRead,
  PERMISSIONS.bidPlace,
  PERMISSIONS.bidReadOwn,
  PERMISSIONS.bidAmendOwn,
  PERMISSIONS.portfolioReadOwn,
];

const OPS_OFFICER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.auctionRead,
  PERMISSIONS.bidReadAll,
  PERMISSIONS.kycReview,
  PERMISSIONS.cdsOpen,
  PERMISSIONS.auctionManage,
  PERMISSIONS.batchPrepare,
  PERMISSIONS.reportRead,
];

/**
 * The supervisor approves but does not prepare. Maker-checker is also enforced at
 * runtime (the approver must differ from the preparer), but keeping the permissions
 * apart means a single role can never complete a BoT submission on its own.
 */
const OPS_SUPERVISOR_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.auctionRead,
  PERMISSIONS.bidReadAll,
  PERMISSIONS.kycReview,
  PERMISSIONS.kycDecide,
  PERMISSIONS.batchApprove,
  PERMISSIONS.reportRead,
];

const TREASURY_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.auctionRead,
  PERMISSIONS.bidReadAll,
  PERMISSIONS.settlementRead,
  PERMISSIONS.settlementReconcile,
  PERMISSIONS.settlementApprove,
  PERMISSIONS.reportRead,
];

const COMPLIANCE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.kycReview,
  PERMISSIONS.kycDecide,
  PERMISSIONS.bidReadAll,
  PERMISSIONS.settlementRead,
  PERMISSIONS.reportRead,
  PERMISSIONS.auditRead,
];

const BOT_OBSERVER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.oversightRead,
  PERMISSIONS.reportRead,
];

const SYSTEM_ADMIN_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.adminUserManage,
  PERMISSIONS.adminSettingsManage,
  PERMISSIONS.auditRead,
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [ROLES.investor]: INVESTOR_PERMISSIONS,
  [ROLES.opsOfficer]: OPS_OFFICER_PERMISSIONS,
  [ROLES.opsSupervisor]: OPS_SUPERVISOR_PERMISSIONS,
  [ROLES.treasuryOfficer]: TREASURY_PERMISSIONS,
  [ROLES.complianceOfficer]: COMPLIANCE_PERMISSIONS,
  [ROLES.botObserver]: BOT_OBSERVER_PERMISSIONS,
  [ROLES.systemAdmin]: SYSTEM_ADMIN_PERMISSIONS,
};

/**
 * Permissions that additionally require a fresh step-up grant (TAD §10.1). Carrying
 * the permission in your token is not enough; you must also present a `pin_token`
 * scoped to the action.
 */
export const STEP_UP_REQUIRED: readonly Permission[] = [
  PERMISSIONS.bidPlace,
  PERMISSIONS.bidAmendOwn,
  PERMISSIONS.batchApprove,
  PERMISSIONS.settlementApprove,
];

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function requiresStepUp(permission: Permission): boolean {
  return STEP_UP_REQUIRED.includes(permission);
}

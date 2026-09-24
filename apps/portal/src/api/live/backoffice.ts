import type { KycAction, KycCase, KycStatus, Risk } from '../types';
import type { Tokens } from './account';
import { tableQuery, type TablePage, type TableParams } from '../../composables/useTable';
import { request } from './http';

/**
 * The back-office endpoints on the investor service, mapped into the shapes the
 * existing screens already render. The screens do not know whether their data is
 * live or mocked.
 */

interface CaseDto {
  reference: string;
  name: string;
  type: string;
  channel: string;
  reasons: string[];
  risk: 'low' | 'medium' | 'high';
  status: string;
  openedAt: string;
  slaDueAt: string;
  sourceA: string;
  sourceB: string;
  fields: KycCase['fields'];
  screening: KycCase['screening'];
  maker: { id: string; name: string | null; note: string | null } | null;
  checker: { id: string; name: string | null; note: string | null } | null;
}

export interface CdsTask {
  reference: string;
  investorReference: string;
  name: string;
  nidaNumber: string | null;
  dateOfBirth: string | null;
  bankAccount: string | null;
  bankStatus: string | null;
  requestedAt: string;
}

const STATUS: Record<string, KycStatus> = {
  new: 'New',
  info_requested: 'Info requested',
  awaiting_checker: 'Awaiting checker',
  returned: 'Returned',
  approved: 'Approved',
  rejected: 'Rejected',
};
const RISK: Record<string, Risk> = { low: 'Low', medium: 'Medium', high: 'High' };
const CHANNEL: Record<string, string> = {
  web: 'Web portal',
  mobile: 'Mobile app',
  ussd: 'USSD',
  chatbot: 'Chatbot',
  branch: 'Branch',
};

export function toKycCase(dto: CaseDto): KycCase {
  return {
    id: dto.reference,
    name: dto.name,
    type: dto.type.charAt(0).toUpperCase() + dto.type.slice(1),
    channel: CHANNEL[dto.channel] ?? dto.channel,
    reason: dto.reasons[0] ?? 'Needs review',
    reasons: dto.reasons,
    risk: RISK[dto.risk] ?? 'Medium',
    openedAt: dto.openedAt,
    slaHours: Math.round((Date.parse(dto.slaDueAt) - Date.parse(dto.openedAt)) / 3_600_000),
    sourceA: dto.sourceA,
    sourceB: dto.sourceB,
    fields: dto.fields,
    screening: dto.screening,
    status: STATUS[dto.status] ?? 'New',
    makerId: dto.maker?.id ?? null,
    makerName: dto.maker?.name ?? null,
    makerNote: dto.maker?.note ?? null,
    checkerName: dto.checker?.name ?? null,
    checkerNote: dto.checker?.note ?? null,
  };
}

export const backofficeApi = {
  signIn: (username: string, password: string) =>
    request<Tokens>('identity', '/v1/auth/staff/login', { method: 'POST', body: { username, password }, auth: false }),
  kycCases: async () => (await request<CaseDto[]>('investor', '/v1/kyc/cases')).map(toKycCase),
  actOnKyc: async (reference: string, action: KycAction, note?: string) =>
    toKycCase(
      await request<CaseDto>('investor', `/v1/kyc/cases/${encodeURIComponent(reference)}/actions`, {
        method: 'POST',
        body: { action, ...(note ? { note } : {}) },
      }),
    ),
  cdsTasks: () => request<CdsTask[]>('investor', '/v1/cds/requests'),
  completeCds: (reference: string, cdsAccount: string) =>
    request<{ reference: string; status: string; cdsAccount: string; canBid: boolean }>(
      'investor',
      `/v1/cds/requests/${encodeURIComponent(reference)}/complete`,
      { method: 'POST', body: { cdsAccount } },
    ),
};

// ---------------------------------------------------------------- registers and users


export interface CustomerRow {
  reference: string;
  name: string | null;
  nidaNumber: string | null;
  type: string;
  status: string;
  canBid: boolean;
  risk: string | null;
  bankAccount: string | null;
  bankStatus: string | null;
  cdsAccount: string | null;
  cdsStatus: string;
  registeredAt: string;
  submittedAt: string | null;
}

export interface CustomerDetail {
  reference: string;
  type: string;
  status: string;
  risk: string | null;
  name: string | null;
  nidaNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gender: string | null;
  tin: string | null;
  dateOfBirth: string | null;
  occupation: string | null;
  sourceOfFunds: string | null;
  pepDeclared: boolean | null;
  registeredAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  bank: { status: string | null; account: string | null; openingRef: string | null };
  cds: { status: string; account: string | null };
  checks: { source: string; outcome: string; at: string; details: { reasons?: string[] } }[];
  cases: { reference: string; status: string; risk: string; openedAt: string }[];
  history: { action: string; by: string | null; role: string; subject: string; note: string | null; at: string }[];
}

export interface CdsRegisterRow {
  cdsAccount: string;
  investorReference: string;
  name: string | null;
  requestReference: string;
  recordedBy: string | null;
  recordedAt: string;
}

export interface BankAccountRow {
  investorReference: string;
  name: string | null;
  bankStatus: string;
  bankAccount: string | null;
  cbsCustomerId: string | null;
  openingReference: string | null;
  approvedAt: string | null;
}

export interface StaffRow {
  accountId: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CustomerLoginRow {
  accountId: string;
  phone: string;
  registeredAt: string;
  lastLoginAt: string | null;
  pinSet: boolean;
  pinLocked: boolean;
  activeSessions: number;
  unlockPending: boolean;
}

export interface UnlockRequestRow {
  id: string;
  accountId: string;
  phone?: string;
  requestedBy: string | null;
  reason: string;
  status: string;
  decidedBy: string | null;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

export interface CustomerLoginDetail {
  accountId: string;
  phone: string;
  registeredAt: string;
  lastLoginAt: string | null;
  pinSet: boolean;
  pinSetAt: string | null;
  pinLocked: boolean;
  pinLockedAt: string | null;
  failedPinAttempts: number;
  sessions: { startedAt: string; expiresAt: string; ipAddress: string | null; device: string | null }[];
  unlockRequests: UnlockRequestRow[];
  history: { action: string; by: string | null; detail: string | null; reason: string | null; at: string }[];
}

const table = <T>(service: 'identity' | 'investor', path: string) => (params: TableParams) =>
  request<TablePage<T>>(service, `${path}?${tableQuery(params)}`);

export const registersApi = {
  customers: table<CustomerRow>('investor', '/v1/investors'),
  customer: (reference: string) => request<CustomerDetail>('investor', `/v1/investors/${encodeURIComponent(reference)}`),
  cdsRegister: table<CdsRegisterRow>('investor', '/v1/cds/accounts'),
  bankAccounts: table<BankAccountRow>('investor', '/v1/bank-accounts'),
};

export const usersApi = {
  staff: table<StaffRow>('identity', '/v1/admin/staff'),
  staffHistory: (id: string) =>
    request<{ action: string; by: string | null; detail: string | null; reason: string | null; at: string }[]>(
      'identity',
      `/v1/admin/staff/${id}/history`,
    ),
  createStaff: (body: { username: string; displayName: string; role: string; password?: string; reason: string }) =>
    request<{ accountId: string }>('identity', '/v1/admin/staff', { method: 'POST', body }),
  updateStaff: (id: string, body: { role?: string; status?: 'active' | 'suspended'; reason: string }) =>
    request<StaffRow>('identity', `/v1/admin/staff/${id}`, { method: 'PATCH', body }),
  unlockStaff: (id: string, reason: string) =>
    request<void>('identity', `/v1/admin/staff/${id}/unlock`, { method: 'POST', body: { reason } }),
  resetStaffPassword: (id: string, password: string, reason: string) =>
    request<void>('identity', `/v1/admin/staff/${id}/password`, { method: 'POST', body: { password, reason } }),

  customerLogins: table<CustomerLoginRow>('identity', '/v1/admin/customer-logins'),
  customerLogin: (id: string) => request<CustomerLoginDetail>('identity', `/v1/admin/customer-logins/${id}`),
  signOutCustomer: (id: string, reason: string) =>
    request<{ sessionsEnded: number }>('identity', `/v1/admin/customer-logins/${id}/sign-out`, {
      method: 'POST',
      body: { reason },
    }),
  requestUnlock: (id: string, reason: string) =>
    request<UnlockRequestRow>('identity', `/v1/admin/customer-logins/${id}/unlock-requests`, {
      method: 'POST',
      body: { reason },
    }),
  unlockRequests: table<UnlockRequestRow>('identity', '/v1/admin/customer-logins/unlock-requests'),
  decideUnlock: (id: string, decision: 'approve' | 'reject', note?: string) =>
    request<void>('identity', `/v1/admin/customer-logins/unlock-requests/${id}/decision`, {
      method: 'POST',
      body: { decision, ...(note ? { note } : {}) },
    }),
};

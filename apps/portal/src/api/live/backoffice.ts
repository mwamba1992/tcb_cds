import type { KycAction, KycCase, KycStatus, Risk } from '../types';
import type { Tokens } from './account';
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

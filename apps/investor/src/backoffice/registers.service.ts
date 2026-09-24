import { Injectable, Logger } from '@nestjs/common';
import { tableOrder, tablePage, tableWindow, type TableQuery } from '@govsec/pagination';
import { isValidReference, normaliseReference } from '@govsec/reference';
import { Prisma } from '../generated/prisma/client';
import { IdentityClient } from '../clients/clients';
import { PrismaService } from '../prisma/prisma.service';

/** Lists show a masked NIN; the full number is on the detail page, where views are logged. */
export function maskNida(nin: string | null | undefined): string | null {
  if (!nin) return null;
  return `${nin.slice(0, 4)}••••••••••••${nin.slice(-4)}`;
}

const fullName = (p: { firstName: string; middleName: string | null; lastName: string } | null) =>
  p ? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') : null;

export const CUSTOMER_STATUSES = [
  'draft',
  'under_review',
  'info_requested',
  'approved',
  'rejected',
  'ready',
  'awaiting_accounts',
] as const;

/**
 * The back office's registers: every customer, every CDS account recorded, every TCB
 * settlement account. All three use the platform's table paging.
 */
@Injectable()
export class RegistersService {
  private readonly logger = new Logger(RegistersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityClient,
  ) {}

  /**
   * Search takes whatever the caller has: an NV- reference, a phone number, NIDA digits
   * or part of a name. Sort by name, registered or submitted.
   */
  async customers(query: TableQuery & { status?: string }) {
    const window = tableWindow(query);
    const where: Prisma.InvestorWhereInput = {
      ...statusWhere(query.status),
      ...(await this.searchWhere(query.q)),
    };
    const [rows, total] = await Promise.all([
      this.prisma.investor.findMany({
        where,
        include: { individual: true },
        orderBy: tableOrder(
          query.sort,
          { registered: 'createdAt', submitted: 'submittedAt', status: 'status', risk: 'risk' },
          { field: 'registered', dir: 'desc' },
        ),
        skip: window.skip,
        take: window.take,
      }),
      this.prisma.investor.count({ where }),
    ]);
    return tablePage(
      rows.map((i) => ({
        reference: i.reference,
        name: fullName(i.individual),
        nidaNumber: maskNida(i.individual?.nidaNumber),
        type: i.type,
        status: i.status,
        canBid: i.status === 'approved' && i.cdsStatus === 'active' && i.bankAccount !== null,
        risk: i.risk,
        bankAccount: i.bankAccount,
        bankStatus: i.bankStatus,
        cdsAccount: i.cdsAccount,
        cdsStatus: i.cdsStatus,
        registeredAt: i.createdAt,
        submittedAt: i.submittedAt,
      })),
      total,
      window,
    );
  }

  /** Every CDS account recorded. Search by CDS number, name or NV- reference. */
  async cdsRegister(query: TableQuery) {
    const window = tableWindow(query);
    const q = query.q?.trim();
    const where: Prisma.CdsRequestWhereInput = {
      status: 'completed',
      ...(q
        ? {
            OR: [
              { cdsAccount: { contains: q.toUpperCase() } },
              { investor: nameOrReference(q) },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.cdsRequest.findMany({
        where,
        include: { investor: { include: { individual: true } } },
        orderBy: tableOrder(query.sort, { opened: 'completedAt', account: 'cdsAccount' }, { field: 'opened', dir: 'desc' }),
        skip: window.skip,
        take: window.take,
      }),
      this.prisma.cdsRequest.count({ where }),
    ]);
    return tablePage(
      rows.map((r) => ({
        cdsAccount: r.cdsAccount,
        investorReference: r.investor.reference,
        name: fullName(r.investor.individual),
        requestReference: r.reference,
        recordedBy: r.completedByName,
        recordedAt: r.completedAt,
        requestedAt: r.createdAt,
      })),
      total,
      window,
    );
  }

  /** Settlement accounts, linked or being opened. ?status=existing|requested|opened */
  async bankAccounts(query: TableQuery & { status?: string }) {
    const window = tableWindow(query);
    const q = query.q?.trim();
    const where: Prisma.InvestorWhereInput = {
      bankStatus: query.status ? query.status : { not: null },
      ...(q
        ? {
            OR: [
              { bankAccount: { contains: q.replace(/\s/g, '') } },
              { accountOpeningRef: { contains: q.toUpperCase() } },
              nameOrReference(q),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.investor.findMany({
        where,
        include: { individual: true },
        orderBy: tableOrder(query.sort, { registered: 'createdAt', status: 'bankStatus' }, { field: 'registered', dir: 'desc' }),
        skip: window.skip,
        take: window.take,
      }),
      this.prisma.investor.count({ where }),
    ]);
    return tablePage(
      rows.map((i) => ({
        investorReference: i.reference,
        name: fullName(i.individual),
        bankStatus: i.bankStatus,
        bankAccount: i.bankAccount,
        cbsCustomerId: i.cbsCustomerId,
        openingReference: i.accountOpeningRef,
        approvedAt: i.approvedAt,
      })),
      total,
      window,
    );
  }

  private async searchWhere(raw: string | undefined): Promise<Prisma.InvestorWhereInput> {
    const q = raw?.trim();
    if (!q) return {};
    if (isValidReference(q, 'investor')) return { reference: normaliseReference(q) };
    const digits = q.replace(/[\s-]/g, '');
    if (/^(\+?255|0)[67]\d{8}$/.test(digits)) {
      try {
        const accountId = await this.identity.accountByPhone(digits);
        return { accountId: accountId ?? '00000000-0000-0000-0000-000000000000' };
      } catch (error) {
        this.logger.warn(`Phone search unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return { id: '00000000-0000-0000-0000-000000000000' };
      }
    }
    if (/^\d{6,20}$/.test(digits)) return { individual: { nidaNumber: { contains: digits } } };
    return nameOrReference(q);
  }
}

function nameOrReference(q: string): Prisma.InvestorWhereInput {
  const words = q.split(/\s+/).filter(Boolean).slice(0, 3);
  return {
    OR: [
      { reference: { contains: q.toUpperCase() } },
      {
        individual: {
          AND: words.map((w) => ({
            OR: [
              { firstName: { contains: w, mode: 'insensitive' as const } },
              { middleName: { contains: w, mode: 'insensitive' as const } },
              { lastName: { contains: w, mode: 'insensitive' as const } },
            ],
          })),
        },
      },
    ],
  };
}

function statusWhere(status: string | undefined): Prisma.InvestorWhereInput {
  switch (status) {
    case undefined:
    case '':
      return {};
    case 'ready':
      return { status: 'approved', cdsStatus: 'active', bankAccount: { not: null } };
    case 'awaiting_accounts':
      return { status: 'approved', OR: [{ cdsStatus: { not: 'active' } }, { bankAccount: null }] };
    default:
      return { status };
  }
}

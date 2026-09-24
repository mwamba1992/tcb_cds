import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLES, type AuthenticatedUser } from '@govsec/auth';
import { tableOrder, tablePage, tableWindow, type TableQuery } from '@govsec/pagination';
import { normalisePhone, maskPhone } from '../auth/phone';
import { PrismaService } from '../prisma/prisma.service';
import { adminAction } from './audit';

/**
 * Customer sign-in support for the contact centre and branches: find a customer's
 * login, see whether their PIN is locked and where they are signed in, sign them out
 * everywhere (a lost phone), and unlock a PIN with maker-checker.
 *
 * Lists show masked phone numbers; the full number appears only on the detail view,
 * and each detail view is recorded.
 */
@Injectable()
export class CustomerLoginsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Search matches the phone number (full or partial digits); sort by registered or lastLogin. */
  async list(input: TableQuery & { locked?: boolean }) {
    const window = tableWindow(input);
    const phone = input.q ? normalisePhone(input.q) : null;
    const digits = input.q?.replace(/\D/g, '') ?? '';
    const where = {
      role: ROLES.investor,
      ...(phone ? { phoneNumber: phone } : input.q ? { phoneNumber: { contains: digits || '-' } } : {}),
      ...(input.locked ? { pinLockedAt: { not: null } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        orderBy: tableOrder(
          input.sort,
          { registered: 'createdAt', lastLogin: 'lastLoginAt' },
          { field: 'registered', dir: 'desc' },
        ),
        skip: window.skip,
        take: window.take,
        include: {
          _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
        },
      }),
      this.prisma.account.count({ where }),
    ]);
    const pending = await this.pendingFor(rows.map((r) => r.id));
    return tablePage(
      rows.map((a) => ({
        accountId: a.id,
        phone: a.phoneNumber ? maskPhone(a.phoneNumber) : null,
        registeredAt: a.createdAt,
        lastLoginAt: a.lastLoginAt,
        pinSet: a.pinHash !== null,
        pinLocked: a.pinLockedAt !== null,
        activeSessions: a._count.sessions,
        unlockPending: pending.has(a.id),
      })),
      total,
      window,
    );
  }

  async detail(actor: AuthenticatedUser, accountId: string) {
    const account = await this.customer(accountId);
    const [sessions, requests, history] = await Promise.all([
      this.prisma.session.findMany({
        where: { accountId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.unlockRequest.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.adminAction.findMany({ where: { targetId: accountId }, orderBy: { at: 'desc' }, take: 50 }),
    ]);
    await this.prisma.adminAction.create({ data: adminAction(actor, 'customer.view', accountId) });
    return {
      accountId: account.id,
      phone: account.phoneNumber,
      locale: account.locale,
      registeredAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
      pinSet: account.pinHash !== null,
      pinSetAt: account.pinSetAt,
      pinLocked: account.pinLockedAt !== null,
      pinLockedAt: account.pinLockedAt,
      failedPinAttempts: account.pinFailedAttempts,
      sessions: sessions.map((s) => ({ startedAt: s.createdAt, expiresAt: s.expiresAt, ipAddress: s.ipAddress, device: s.userAgent })),
      unlockRequests: requests.map(requestView),
      history: history.map((h) => ({ action: h.action, by: h.actorName, detail: h.detail, reason: h.reason, at: h.at })),
    };
  }

  async signOutEverywhere(actor: AuthenticatedUser, accountId: string, reason: string) {
    await this.customer(accountId);
    const now = new Date();
    const [revoked] = await this.prisma.$transaction([
      this.prisma.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.adminAction.create({ data: adminAction(actor, 'customer.sign_out', accountId, { reason }) }),
    ]);
    return { sessionsEnded: revoked.count };
  }

  async requestUnlock(actor: AuthenticatedUser, accountId: string, reason: string) {
    const account = await this.customer(accountId);
    if (!account.pinLockedAt) {
      throw new ConflictException({ code: 'not_locked', message: 'This PIN is not locked' });
    }
    const open = await this.prisma.unlockRequest.findFirst({ where: { accountId, status: 'pending' } });
    if (open) throw new ConflictException({ code: 'already_requested', message: 'An unlock is already waiting for approval' });
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.unlockRequest.create({
        data: { accountId, requestedBy: actor.accountId, requestedByName: actor.name ?? null, reason },
      });
      await tx.adminAction.create({ data: adminAction(actor, 'customer.unlock.request', accountId, { reason }) });
      return requestView(request);
    });
  }

  /** Oldest first: whoever has waited longest is decided first. */
  async pendingRequests(query: TableQuery) {
    const window = tableWindow(query);
    const where = { status: 'pending' };
    const [requests, total] = await Promise.all([
      this.prisma.unlockRequest.findMany({
        where,
        orderBy: tableOrder(query.sort, { requested: 'createdAt' }, { field: 'requested', dir: 'asc' }),
        skip: window.skip,
        take: window.take,
      }),
      this.prisma.unlockRequest.count({ where }),
    ]);
    const phones = await this.prisma.account.findMany({
      where: { id: { in: requests.map((r) => r.accountId) } },
      select: { id: true, phoneNumber: true },
    });
    const phoneOf = new Map(phones.map((p) => [p.id, p.phoneNumber]));
    return tablePage(
      requests.map((r) => ({ ...requestView(r), phone: maskPhone(phoneOf.get(r.accountId) ?? '') })),
      total,
      window,
    );
  }

  /** The approver must not be the requester; the conditional update settles a race. */
  async decide(actor: AuthenticatedUser, requestId: string, approve: boolean, note: string | undefined) {
    const request = await this.prisma.unlockRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Unlock request not found');
    if (request.status !== 'pending') {
      throw new ConflictException({ code: 'invalid_state', message: 'This request has already been decided' });
    }
    if (request.requestedBy === actor.accountId) {
      throw new ForbiddenException({ code: 'maker_checker', message: 'A different user must decide a request you made' });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.unlockRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: approve ? 'approved' : 'rejected',
          decidedBy: actor.accountId,
          decidedByName: actor.name ?? null,
          note: note ?? null,
          decidedAt: now,
        },
      });
      if (decided.count !== 1) {
        throw new ConflictException({ code: 'invalid_state', message: 'This request has already been decided' });
      }
      if (approve) {
        await tx.account.update({
          where: { id: request.accountId },
          data: { pinLockedAt: null, pinFailedAttempts: 0 },
        });
      }
      await tx.adminAction.create({
        data: adminAction(actor, approve ? 'customer.unlock.approve' : 'customer.unlock.reject', request.accountId, {
          ...(note ? { reason: note } : {}),
        }),
      });
    });
  }

  private async pendingFor(accountIds: string[]): Promise<Set<string>> {
    if (accountIds.length === 0) return new Set();
    const rows = await this.prisma.unlockRequest.findMany({
      where: { accountId: { in: accountIds }, status: 'pending' },
      select: { accountId: true },
    });
    return new Set(rows.map((r) => r.accountId));
  }

  private async customer(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.role !== ROLES.investor) throw new NotFoundException('Customer not found');
    return account;
  }
}

function requestView(r: {
  id: string;
  accountId: string;
  requestedByName: string | null;
  reason: string;
  status: string;
  decidedByName: string | null;
  note: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}) {
  return {
    id: r.id,
    accountId: r.accountId,
    requestedBy: r.requestedByName,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decidedByName,
    note: r.note,
    requestedAt: r.createdAt,
    decidedAt: r.decidedAt,
  };
}

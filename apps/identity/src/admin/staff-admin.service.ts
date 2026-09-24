import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isRole, ROLES, type AuthenticatedUser, type Role } from '@govsec/auth';
import { CONFIG, type IdentityConfig } from '../config/configuration';
import { tableOrder, tablePage, tableWindow, type TableQuery } from '@govsec/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { SecretHasher } from '../auth/secret-hasher';
import { adminAction } from './audit';

const STAFF_ROLES = [
  ROLES.opsOfficer,
  ROLES.opsSupervisor,
  ROLES.complianceOfficer,
  ROLES.treasuryOfficer,
  ROLES.botObserver,
  ROLES.systemAdmin,
] as const;

/**
 * Staff user management for ICT administrators.
 *
 * Two rules keep one administrator from quietly giving themselves power: nobody
 * changes their own role or status, and every change is recorded with a reason.
 * Disabling signs the person out at once, so it takes effect before their access
 * token's 15 minutes run out on the next refresh.
 */
@Injectable()
export class StaffAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasher,
    @Inject(CONFIG) private readonly config: IdentityConfig,
  ) {}

  /** Search matches name or username; sort by name, role, lastLogin or created. */
  async list(query: TableQuery & { role?: string; status?: string }) {
    const window = tableWindow(query);
    const q = query.q?.trim();
    const where = {
      role: query.role && query.role !== ROLES.investor ? query.role : { not: ROLES.investor },
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' as const } },
              { username: { contains: q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        orderBy: tableOrder(
          query.sort,
          { name: 'displayName', role: 'role', lastLogin: 'lastLoginAt', created: 'createdAt' },
          { field: 'name', dir: 'asc' },
        ),
        skip: window.skip,
        take: window.take,
      }),
      this.prisma.account.count({ where }),
    ]);
    return tablePage(rows.map(staffView), total, window);
  }

  async history(accountId: string) {
    const actions = await this.prisma.adminAction.findMany({
      where: { targetId: accountId },
      orderBy: { at: 'desc' },
      take: 100,
    });
    return actions.map((a) => ({ action: a.action, by: a.actorName, detail: a.detail, reason: a.reason, at: a.at }));
  }

  async create(
    actor: AuthenticatedUser,
    input: { username: string; displayName: string; role: string; password?: string; reason: string },
  ) {
    const role = this.staffRole(input.role);
    const username = input.username.trim().toLowerCase();
    if (await this.prisma.account.findUnique({ where: { username } })) {
      throw new ConflictException({ code: 'username_taken', message: 'That username is already in use' });
    }
    const passwordHash = await this.initialPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: { username, displayName: input.displayName.trim(), role, passwordHash },
      });
      await tx.adminAction.create({
        data: adminAction(actor, 'staff.create', created.id, { detail: `${username} as ${role}`, reason: input.reason }),
      });
      return { accountId: created.id, username, role };
    });
  }

  async update(
    actor: AuthenticatedUser,
    accountId: string,
    input: { role?: string; status?: 'active' | 'suspended'; reason: string },
  ) {
    if (accountId === actor.accountId) {
      throw new ForbiddenException({ code: 'self_change', message: 'You cannot change your own role or status' });
    }
    const target = await this.staffAccount(accountId);
    const role = input.role === undefined ? undefined : this.staffRole(input.role);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: { ...(role ? { role } : {}), ...(input.status ? { status: input.status } : {}) },
      });
      if (role && role !== target.role) {
        await tx.adminAction.create({
          data: adminAction(actor, 'staff.role', accountId, { detail: `${target.role} → ${role}`, reason: input.reason }),
        });
      }
      if (input.status && input.status !== target.status) {
        await tx.adminAction.create({
          data: adminAction(actor, input.status === 'active' ? 'staff.enable' : 'staff.disable', accountId, {
            reason: input.reason,
          }),
        });
      }
      // A role change or disable must not wait for the old token to lapse on refresh.
      if ((role && role !== target.role) || input.status === 'suspended') {
        await tx.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } });
      }
    });
    return staffView(await this.staffAccount(accountId));
  }

  async unlock(actor: AuthenticatedUser, accountId: string, reason: string) {
    await this.staffAccount(accountId);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { passwordLockedAt: null, passwordFailedAttempts: 0 },
      }),
      this.prisma.adminAction.create({ data: adminAction(actor, 'staff.unlock', accountId, { reason }) }),
    ]);
  }

  /** Development only, like password sign-in itself. */
  async resetPassword(actor: AuthenticatedUser, accountId: string, password: string, reason: string) {
    if (!this.config.staffPasswordLogin) throw new NotFoundException();
    await this.staffAccount(accountId);
    const passwordHash = await this.initialPassword(password);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { passwordHash, passwordLockedAt: null, passwordFailedAttempts: 0 },
      }),
      this.prisma.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.adminAction.create({ data: adminAction(actor, 'staff.password_reset', accountId, { reason }) }),
    ]);
  }

  private async initialPassword(password: string | undefined): Promise<string | null> {
    if (!password) return null;
    if (!this.config.staffPasswordLogin) {
      throw new BadRequestException({ code: 'no_passwords', message: 'Staff sign in through TCB directory; no password is set here' });
    }
    if (password.length < 10) {
      throw new BadRequestException({ code: 'weak_password', message: 'Password must be at least 10 characters' });
    }
    return this.hasher.hash(password);
  }

  private staffRole(value: string): Role {
    if (!isRole(value) || !(STAFF_ROLES as readonly string[]).includes(value)) {
      throw new BadRequestException({ code: 'invalid_role', message: `"${value}" is not a staff role` });
    }
    return value;
  }

  private async staffAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.role === ROLES.investor) throw new NotFoundException('Staff user not found');
    return account;
  }
}

function staffView(a: {
  id: string;
  username: string | null;
  displayName: string | null;
  role: string;
  status: string;
  passwordLockedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    accountId: a.id,
    username: a.username,
    displayName: a.displayName,
    role: a.role,
    status: a.status,
    locked: a.passwordLockedAt !== null,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
  };
}

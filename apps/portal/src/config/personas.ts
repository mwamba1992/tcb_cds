import { ROLES, permissionsForRole, type Role } from '@govsec/auth/roles';
import type { SessionUser } from '../api/types';

/**
 * Sample users for the mocked sign-in.
 *
 * The design's single "Treasury Operations" persona is split along the platform's
 * roles (TAD §10.1): an operations officer prepares (maker), an operations supervisor
 * approves (checker), and treasury owns settlement reconciliation. Screens and actions
 * follow the user's permissions, so each persona sees what that role would.
 */
function persona(id: string, name: string, role: Role, roleLabel: string): SessionUser {
  // First and last name, as the design shows ("Amina Said Mfinanga" → "AM").
  const parts = name.split(' ').filter(Boolean);
  const initials = `${parts[0]?.charAt(0) ?? ''}${parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : ''}`;
  return { id, name, initials, role, roleLabel, permissions: permissionsForRole(role) };
}

export const PERSONAS = {
  investor: persona('u-investor', 'Amina Said Mfinanga', ROLES.investor, 'Individual investor'),
  maker: persona('u-maker', 'Rose Mollel', ROLES.opsOfficer, 'Operations · Maker'),
  checker: persona('u-checker', 'Salum Kweka', ROLES.opsSupervisor, 'Operations · Checker'),
  treasury: persona('u-treasury', 'Faraji Mrema', ROLES.treasuryOfficer, 'Treasury · Settlement'),
} as const;

export type StaffPersona = 'maker' | 'checker' | 'treasury';

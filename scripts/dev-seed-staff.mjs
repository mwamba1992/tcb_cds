#!/usr/bin/env node
/**
 * Creates the development staff accounts, one per back-office role.
 *
 *   node scripts/dev-seed-staff.mjs
 *
 * Development only: production staff sign in through TCB's directory, and identity
 * refuses password sign-in in production. Re-running resets each password and
 * clears any lockout. Every name is fictitious.
 */
import { hash } from '@node-rs/argon2';
import { config } from 'dotenv';
import pg from 'pg';

config({ quiet: true });
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed development staff in production.');
  process.exit(1);
}

const password = process.env.DEV_STAFF_PASSWORD ?? 'Govsec-dev-2026';
const STAFF = [
  { username: 'rose.mollel', displayName: 'Rose Mollel', role: 'ops_officer' },
  { username: 'salum.kweka', displayName: 'Salum Kweka', role: 'ops_supervisor' },
  { username: 'neema.lyimo', displayName: 'Neema Lyimo', role: 'compliance_officer' },
  { username: 'faraji.mrema', displayName: 'Faraji Mrema', role: 'treasury_officer' },
  { username: 'amani.ict', displayName: 'Amani Shayo', role: 'system_admin' },
];

const url = new URL(process.env.IDENTITY_DATABASE_URL);
const schema = url.searchParams.get('schema') ?? 'identity';
url.searchParams.delete('schema');
const client = new pg.Client({ connectionString: url.toString(), options: `-c search_path=${schema}` });
await client.connect();

const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
for (const s of STAFF) {
  await client.query(
    `INSERT INTO accounts (id, username, display_name, role, status, password_hash, phone_verified, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'active', $4, false, now())
     ON CONFLICT (username) DO UPDATE
        SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash,
            password_failed_attempts = 0, password_locked_at = NULL, status = 'active', updated_at = now()`,
    [s.username, s.displayName, s.role, passwordHash],
  );
  console.log(`  ${s.username.padEnd(14)} ${s.role}`);
}
await client.end();
console.log(`\nDevelopment staff ready. Password for all: ${password}`);

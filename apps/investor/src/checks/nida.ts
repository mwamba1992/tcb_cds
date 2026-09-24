import type { CheckResult, FieldComparison } from './check-result';
import { compareNames } from './names';

/** What the National Identification Authority holds for a NIN. */
export interface NidaRecord {
  fullName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  gender: 'M' | 'F';
}

export interface NidaRegistry {
  lookup(nidaNumber: string): Promise<NidaRecord | null>;
}

export const NIDA_REGISTRY = 'NIDA_REGISTRY';

/**
 * NIDA stand-in until TCB's NIDA verification subscription is connected.
 *
 * A NIN begins with the holder's date of birth (YYYYMMDD). The stub answers for the
 * fictitious people used across the demo data, and for any other well-formed NIN
 * returns a holder born on the encoded date whose name is left for the declared one
 * — so a developer can register anyone, while a wrong date of birth is still caught.
 */
const KNOWN: Record<string, NidaRecord> = {
  '19900521131050000137': { fullName: 'ASHA JUMA MUSSA', dateOfBirth: '1990-05-21', gender: 'F' },
  '19860314112030000124': { fullName: 'JUMA HASSAN MWINYI', dateOfBirth: '1986-03-14', gender: 'M' },
  '19791102141170000211': { fullName: 'GRACE ANNA NDEGE', dateOfBirth: '1979-11-02', gender: 'F' },
  '19750809121010000345': { fullName: 'ALI OMAR SAID', dateOfBirth: '1975-08-09', gender: 'M' },
};

export class StubNidaRegistry implements NidaRegistry {
  async lookup(nidaNumber: string): Promise<NidaRecord | null> {
    const known = KNOWN[nidaNumber];
    if (known) return known;
    const dateOfBirth = dateFromNin(nidaNumber);
    return dateOfBirth ? { fullName: '', dateOfBirth, gender: 'M' } : null;
  }
}

export function dateFromNin(nidaNumber: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})\d{12}$/.exec(nidaNumber);
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y}-${m}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/** Declared details against the NIDA record. */
export function checkAgainstNida(
  declared: { fullName: string; dateOfBirth: string; nidaNumber: string },
  record: NidaRecord | null,
): CheckResult & { record: NidaRecord | null } {
  if (!record) {
    return {
      source: 'nida',
      outcome: 'review',
      reasons: ['NIDA number not found in the registry'],
      details: { fields: [] },
      record: null,
    };
  }
  // The stub's echo case: no registry name to compare, so the declared one stands.
  const registryName = record.fullName || declared.fullName.toUpperCase();
  const name = compareNames(declared.fullName, registryName);
  const fields: FieldComparison[] = [
    {
      label: 'Full name',
      a: declared.fullName.toUpperCase(),
      b: registryName,
      result: name === 'exact' ? 'match' : 'mismatch',
    },
    {
      label: 'Date of birth',
      a: declared.dateOfBirth,
      b: record.dateOfBirth,
      result: declared.dateOfBirth === record.dateOfBirth ? 'match' : 'mismatch',
    },
    { label: 'NIDA number', a: declared.nidaNumber, b: declared.nidaNumber, result: 'match' },
  ];
  const reasons: string[] = [];
  if (name !== 'exact') reasons.push('Declared name differs from NIDA');
  if (declared.dateOfBirth !== record.dateOfBirth) reasons.push('Date of birth differs from NIDA');
  return {
    source: 'nida',
    outcome: reasons.length === 0 ? 'clear' : 'review',
    reasons,
    details: { fields },
    record: { ...record, fullName: registryName },
  };
}

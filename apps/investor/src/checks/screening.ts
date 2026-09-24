import type { CheckResult } from './check-result';
import { screeningScore } from './names';

export interface ListEntry {
  name: string;
  list: string;
}

export interface ScreeningLists {
  sanctions(): Promise<ListEntry[]>;
  peps(): Promise<ListEntry[]>;
}

export const SCREENING_LISTS = 'SCREENING_LISTS';

/** Score at which a name is put in front of compliance. Deliberately low. */
export const SCREENING_REVIEW_THRESHOLD = 0.8;

/**
 * Stand-in lists until TCB's screening provider is connected. Every entry is
 * fictitious; they exist so the review path can be exercised.
 */
export class StubScreeningLists implements ScreeningLists {
  async sanctions(): Promise<ListEntry[]> {
    return [
      { name: 'ALI OMAR SAYED', list: 'UN Consolidated (test entry)' },
      { name: 'VIKTOR PAVEL DRAGAN', list: 'OFAC SDN (test entry)' },
    ];
  }

  async peps(): Promise<ListEntry[]> {
    return [{ name: 'GRACE A NDEGE', list: 'Domestic PEP (test entry)' }];
  }
}

export function screen(source: 'sanctions' | 'pep', fullName: string, entries: ListEntry[]): CheckResult {
  const hits = entries
    .map((entry) => ({ ...entry, score: Math.round(screeningScore(fullName, entry.name) * 100) }))
    .filter((hit) => hit.score >= SCREENING_REVIEW_THRESHOLD * 100)
    .sort((a, b) => b.score - a.score);
  const label = source === 'sanctions' ? 'sanctions list' : 'PEP list';
  return {
    source,
    outcome: hits.length === 0 ? 'clear' : 'review',
    reasons: hits.map((hit) => `Possible ${label} match (${hit.score}%): ${hit.list}`),
    details: { hits },
  };
}

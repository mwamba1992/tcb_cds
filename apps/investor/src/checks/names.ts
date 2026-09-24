/**
 * Comparing personal names across sources that write them differently.
 *
 * NIDA holds "JUMA HASSAN MWINYI", Core Banking "JUMA H. MWINYI", the customer types
 * "Juma Mwinyi". None of these is wrong, and none is an exact match. The comparison
 * therefore works on tokens: order-insensitive, tolerant of initials and of a single
 * typo in a longer name, and it reports how well the names agree rather than a yes/no.
 */

export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // N'GWALA and N’GWALA are one token; JUMA-MUSSA is two, as other sources write it.
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/[^A-Z]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type NameAgreement = 'exact' | 'close' | 'different';

/**
 * - exact: the same tokens, in any order.
 * - close: every token of the shorter name is found in the longer one, allowing
 *   initials and one-letter typos — worth a person's glance, not a refusal.
 * - different: anything else.
 */
export function compareNames(a: string, b: string): NameAgreement {
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 || right.length === 0) return 'different';
  if (left.length === right.length && [...left].sort().join(' ') === [...right].sort().join(' ')) {
    return 'exact';
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 2 && coverage(shorter, longer, 'strict') === 1 ? 'close' : 'different';
}

/**
 * How much of a listed name a candidate accounts for, 0 to 1, for screening. Scored
 * against the listed name so "ALI OMAR SAID" against "ALI OMAR SAYED" scores 1, while
 * a common first name alone against a three-part listing scores a third.
 */
export function screeningScore(candidate: string, listed: string): number {
  const listedTokens = tokens(listed);
  if (listedTokens.length === 0) return 0;
  // Loose: a missed sanctions match costs far more than a reviewer's minute.
  return coverage(listedTokens, tokens(candidate), 'loose');
}

function tokens(name: string): string[] {
  return normaliseName(name).split(' ').filter(Boolean);
}

/** Share of `needles` that find a distinct partner in `haystack`. */
type Tolerance = 'strict' | 'loose';

function coverage(needles: string[], haystack: string[], tolerance: Tolerance): number {
  const available = [...haystack];
  let matched = 0;
  for (const needle of needles) {
    const index = available.findIndex((token) => tokensAgree(needle, token, tolerance));
    if (index >= 0) {
      matched += 1;
      available.splice(index, 1);
    }
  }
  return matched / needles.length;
}

function tokensAgree(a: string, b: string, tolerance: Tolerance): boolean {
  if (a === b) return true;
  // An initial stands for any name beginning with it.
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  const shortest = Math.min(a.length, b.length);
  if (shortest < 4) return false;
  // Strict allows one slip, for comparing a person with their own records. Loose
  // allows two, for transliterations on sanctions lists (SAID / SAYED).
  return editDistance(a, b) <= (tolerance === 'strict' ? 1 : 2);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

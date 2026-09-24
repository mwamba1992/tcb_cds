/** The outcome of one outside check, stored as a verification row. */
export type CheckSource = 'nida' | 'cbs' | 'sanctions' | 'pep';

/**
 * - clear: nothing for a person to look at.
 * - review: a person must decide (a mismatch, a possible list match).
 * - unavailable: the source could not be asked; never treated as clear.
 */
export type CheckOutcome = 'clear' | 'review' | 'unavailable';

export interface FieldComparison {
  label: string;
  a: string;
  b: string;
  result: 'match' | 'mismatch' | 'n/a';
}

export interface CheckResult {
  source: CheckSource;
  outcome: CheckOutcome;
  /** Plain sentences for the reviewer, one per problem. */
  reasons: string[];
  details: Record<string, unknown>;
}

/**
 * The batch reference BoT requires on POST /bids/{batchReference} (spec §6).
 *
 * Format: 8 alphanumeric characters (the participant code BoT assigns at onboarding),
 * a 6-digit date as YYMMDD, and a 3-digit sequence — e.g. `CORPTZTZ-270726-001`.
 *
 * The reference doubles as the idempotency key for a submission: BoT answers 409 to a
 * duplicate, so a retry after a timeout must reuse the reference it first tried, never
 * mint a new one. The sequence is therefore allocated once, in the auction service's
 * database, and this module only formats and validates it.
 */

const PATTERN = /^([A-Z0-9]{8})-(\d{2})(\d{2})(\d{2})-(\d{3})$/;

/** The Tanzanian calendar date, which is the date BoT's operations run on. */
const TIME_ZONE = 'Africa/Dar_es_Salaam';

export class BatchReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchReferenceError';
  }
}

export function formatBatchReference(
  participantCode: string,
  date: Date,
  sequence: number,
): string {
  const code = participantCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw new BatchReferenceError(
      `Participant code must be 8 alphanumeric characters, got "${participantCode}"`,
    );
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new BatchReferenceError(`Batch sequence must be 1–999, got ${sequence}`);
  }
  return `${code}-${yymmdd(date)}-${String(sequence).padStart(3, '0')}`;
}

export function isValidBatchReference(reference: string): boolean {
  const match = PATTERN.exec(reference);
  if (!match) return false;
  const [, , , month, day, sequence] = match;
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && Number(sequence) >= 1;
}

export function parseBatchReference(
  reference: string,
): { participantCode: string; date: string; sequence: number } | null {
  if (!isValidBatchReference(reference)) return null;
  const [, code = '', yy, mm, dd, sequence] = PATTERN.exec(reference) ?? [];
  return { participantCode: code, date: `20${yy}-${mm}-${dd}`, sequence: Number(sequence) };
}

function yymmdd(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

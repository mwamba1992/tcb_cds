/**
 * Dates and times, always in East Africa Time.
 *
 * Auction cut-offs are 10:00 in Dar es Salaam, whatever time zone the investor's
 * laptop is set to. Formatting in the browser's own zone would show a diaspora
 * investor the wrong cut-off, so every formatter here pins the zone.
 */

export const TIME_ZONE = 'Africa/Dar_es_Salaam';

/**
 * Built from en-US parts, in day-month order. en-GB abbreviates September as "Sept",
 * and the design (like BoT's own notices) uses three-letter months throughout.
 */
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface EatParts {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

function eatParts(date: Date): EatParts {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    PARTS.formatToParts(date).find((part) => part.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

const short = (word: string) => word.slice(0, 3);

/** "Wed 24 Sep 2026" */
export function formatAuctionDate(iso: string): string {
  const p = eatParts(new Date(iso));
  return `${short(p.weekday)} ${p.day} ${short(p.month)} ${p.year}`;
}

/** "Wed 24 Sep, 10:00" */
export function formatCutoff(iso: string): string {
  const p = eatParts(new Date(iso));
  return `${short(p.weekday)} ${p.day} ${short(p.month)}, ${p.hour}:${p.minute}`;
}

/** "04 Nov 2026" */
export function formatDate(iso: string): string {
  const p = eatParts(new Date(iso));
  return `${p.day.padStart(2, '0')} ${short(p.month)} ${p.year}`;
}

/** "09:14" */
export function formatTime(iso: string): string {
  const p = eatParts(new Date(iso));
  return `${p.hour}:${p.minute}`;
}

/** "Wednesday, 23 September 2026" */
export function formatLongDate(date: Date): string {
  const p = eatParts(date);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "18:23:49", "7d 18:23:49", or "Closed". */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'Closed';
  const total = Math.floor(msRemaining / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${days ? `${days}d ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** "6h 12m" — the age of a queue item. */
export function formatAge(msElapsed: number): string {
  const minutes = Math.max(0, Math.floor(msElapsed / 60_000));
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** The next occurrence of hh:mm EAT at least `daysAhead` days from `from`. */
export function eatAt(from: Date, daysAhead: number, hour: number, minute = 0): Date {
  // EAT has no daylight saving: a fixed UTC+3 offset is exact.
  const eat = new Date(from.getTime() + 3 * 3_600_000);
  eat.setUTCDate(eat.getUTCDate() + daysAhead);
  eat.setUTCHours(hour - 3, minute, 0, 0);
  return eat;
}

/** "04 Nov 2026, 09:14" (EAT), or an em dash when there is no date. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

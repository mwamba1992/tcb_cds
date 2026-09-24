/**
 * Status → chip tone, from the design's status table.
 *
 * One map for the whole portal, so "Awaiting checker" is the same amber on every
 * screen that shows it. An unknown status falls back to grey rather than guessing.
 */
export type Tone = 'green' | 'amber' | 'blue' | 'red' | 'grey';

const TONES: Record<string, Tone> = {
  Open: 'green',
  Allotted: 'green',
  Approved: 'green',
  Matched: 'green',
  Resolved: 'green',
  'Acknowledged by BoT': 'green',
  'Pending submission': 'amber',
  'Awaiting checker': 'amber',
  'Partially allotted': 'amber',
  Returned: 'amber',
  Submitted: 'blue',
  New: 'blue',
  'Awaiting maker': 'blue',
  'Info requested': 'blue',
  Submitting: 'blue',
  Unsuccessful: 'red',
  Rejected: 'red',
  Break: 'red',
  Upcoming: 'grey',
  Withdrawn: 'grey',
  'Collecting bids': 'grey',
  'Awaiting consolidation': 'grey',
  Closed: 'grey',
  // customers, accounts and users
  'Ready to bid': 'green',
  'Awaiting accounts': 'amber',
  'Under review': 'blue',
  Draft: 'grey',
  Active: 'green',
  Disabled: 'grey',
  Locked: 'red',
  Pending: 'amber',
  Existing: 'green',
  Opened: 'green',
  Requested: 'amber',
  Completed: 'green',
};

/** Customer status as the back office names it: onboarding stage, then whether they can bid. */
export function customerStatusLabel(status: string, canBid: boolean): string {
  if (status === 'approved') return canBid ? 'Ready to bid' : 'Awaiting accounts';
  return (
    { draft: 'Draft', under_review: 'Under review', info_requested: 'Info requested', rejected: 'Rejected' }[status] ??
    status
  );
}

export const ROLE_NAMES: Record<string, string> = {
  investor: 'Investor',
  ops_officer: 'Operations officer (maker)',
  ops_supervisor: 'Operations supervisor (checker)',
  compliance_officer: 'Compliance officer',
  treasury_officer: 'Treasury officer',
  bot_observer: 'BoT observer',
  system_admin: 'ICT administrator',
};

export const capitalise = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

export function toneOf(status: string): Tone {
  return TONES[status] ?? 'grey';
}

export function riskTone(risk: 'Low' | 'Medium' | 'High'): Tone {
  return risk === 'High' ? 'red' : risk === 'Medium' ? 'amber' : 'grey';
}

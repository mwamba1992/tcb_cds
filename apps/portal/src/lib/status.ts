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
};

export function toneOf(status: string): Tone {
  return TONES[status] ?? 'grey';
}

export function riskTone(risk: 'Low' | 'Medium' | 'High'): Tone {
  return risk === 'High' ? 'red' : risk === 'Medium' ? 'amber' : 'grey';
}

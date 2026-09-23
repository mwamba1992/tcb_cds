import {
  eatAt,
  formatAge,
  formatAuctionDate,
  formatCountdown,
  formatCutoff,
  formatDate,
  formatLongDate,
} from './time';

describe('EAT formatting', () => {
  // 07:00 UTC is 10:00 in Dar es Salaam.
  const cutoff = '2026-09-24T07:00:00Z';

  it('formats auction dates and cut-offs in East Africa Time', () => {
    expect(formatAuctionDate(cutoff)).toBe('Thu 24 Sep 2026');
    expect(formatCutoff(cutoff)).toBe('Thu 24 Sep, 10:00');
  });

  it('crosses midnight by EAT, not by UTC', () => {
    // 22:30 UTC on the 3rd is already the 4th in Dar es Salaam.
    expect(formatDate('2026-11-03T22:30:00Z')).toBe('04 Nov 2026');
  });

  it('writes the long date the way the design does', () => {
    expect(formatLongDate(new Date('2026-09-23T09:00:00Z'))).toBe('Wednesday, 23 September 2026');
  });
});

describe('countdowns', () => {
  it('counts down hours, minutes and seconds', () => {
    expect(formatCountdown((18 * 3600 + 23 * 60 + 49) * 1000)).toBe('18:23:49');
  });

  it('adds days when the cut-off is further away', () => {
    expect(formatCountdown((7 * 86400 + 3600) * 1000)).toBe('7d 01:00:00');
  });

  it('says Closed at or after the cut-off', () => {
    expect(formatCountdown(0)).toBe('Closed');
    expect(formatCountdown(-5)).toBe('Closed');
  });

  it('formats queue ages', () => {
    expect(formatAge((6 * 60 + 12) * 60_000)).toBe('6h 12m');
  });
});

describe('eatAt', () => {
  it('lands on 10:00 EAT the next day', () => {
    const from = new Date('2026-09-23T12:00:00Z');
    expect(eatAt(from, 1, 10).toISOString()).toBe('2026-09-24T07:00:00.000Z');
  });
});

import {
  batchReference,
  botCloseAt,
  faceValueProblem,
  holdMinor,
  priceToHundredths,
  tcbCutoffAt,
  tzs,
  type BiddingRules,
} from './bid-rules';

const rules: BiddingRules = {
  botCloseTime: '10:00',
  cutoffHoursBeforeBot: 3,
  commissionBps: 0,
  minimumBill: 500_000,
  minimumBond: 1_000_000,
  bidMultiple: 100_000,
};

describe('cut-off', () => {
  it('closes TCB bidding three hours before BoT, in EAT', () => {
    const close = botCloseAt(new Date('2026-09-25T00:00:00Z'), '10:00');
    expect(close.toISOString()).toBe('2026-09-25T07:00:00.000Z');
    expect(tcbCutoffAt(close, 3).toISOString()).toBe('2026-09-25T04:00:00.000Z');
  });
});

describe('face value', () => {
  it.each([
    ['500000', 'bill', null],
    ['400000', 'bill', 'below_minimum'],
    ['500000', 'bond', 'below_minimum'],
    ['1250000', 'bill', 'not_multiple'],
    ['10000000.50', 'bill', 'not_whole'],
    ['-500000', 'bill', 'not_whole'],
  ])('%s on a %s → %s', (value, instrument, problem) => {
    expect(faceValueProblem(value, instrument, rules)).toBe(problem);
  });
});

describe('price', () => {
  it.each([
    ['88.5', 8850],
    ['88.50', 8850],
    ['100', 10000],
    ['0', null],
    ['88.505', null],
    ['abc', null],
  ])('%s → %s', (price, hundredths) => {
    expect(priceToHundredths(price)).toBe(hundredths);
  });
});

describe('hold', () => {
  it('holds face × price for a competitive bid, exact to the cent', () => {
    expect(tzs(holdMinor(10_000_000n, 8850, 0))).toBe('8850000.00');
    expect(tzs(holdMinor(1_100_000n, 8833, 0))).toBe('971630.00');
  });

  it('holds face value for a non-competitive bid', () => {
    expect(tzs(holdMinor(10_000_000n, null, 0))).toBe('10000000.00');
  });

  it('adds commission on face value when TCB sets one', () => {
    expect(tzs(holdMinor(10_000_000n, 8850, 10))).toBe('8860000.00');
  });
});

describe('batch reference', () => {
  it('uses the EAT date', () => {
    expect(batchReference('TCBGSP01', new Date('2026-09-24T22:30:00Z'), 2)).toBe('TCBGSP01-260925-002');
  });
});

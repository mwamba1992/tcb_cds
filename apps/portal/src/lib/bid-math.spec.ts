import {
  amountProblem,
  commission,
  digitsOnly,
  fundsHold,
  groupDigits,
  indicativeYield,
  isValidPrice,
  settlementEstimate,
  type BidRules,
} from './bid-math';

const bill: BidRules = { minimumBid: '500000', bidMultiple: '100000', commissionBps: 10 };

describe('bid amount', () => {
  it('reads what the investor typed', () => {
    expect(digitsOnly('10,000,000')).toBe('10000000');
    expect(digitsOnly('TZS 007')).toBe('7');
    expect(groupDigits('10000000')).toBe('10,000,000');
  });

  it('accepts an amount at the minimum and in multiples', () => {
    expect(amountProblem('500000', bill)).toBeNull();
    expect(amountProblem('10000000', bill)).toBeNull();
  });

  it('names what is wrong, so the hint can say it', () => {
    expect(amountProblem('', bill)).toBe('empty');
    expect(amountProblem('400000', bill)).toBe('below-minimum');
    expect(amountProblem('550000', bill)).toBe('not-multiple');
  });
});

describe('price', () => {
  it('accepts prices BoT would accept', () => {
    expect(isValidPrice('88.50')).toBe(true);
    expect(isValidPrice('110')).toBe(true);
  });

  it('refuses zero, above 110, and more than two decimals', () => {
    expect(isValidPrice('0')).toBe(false);
    expect(isValidPrice('110.01')).toBe(false);
    expect(isValidPrice('88.505')).toBe(false);
    expect(isValidPrice('')).toBe(false);
  });
});

describe('hold and commission', () => {
  it('matches the design: 0.10% of 10,000,000 is 10,000, held on top', () => {
    expect(commission('10000000', bill)).toBe('10000.00');
    expect(fundsHold('10000000', bill)).toBe('10010000.00');
  });

  it('rounds commission half-up to the cent', () => {
    expect(commission('500005', bill)).toBe('500.01');
  });

  it('estimates settlement from price', () => {
    expect(settlementEstimate('10000000', '88.50')).toBe('8850000.00');
  });
});

describe('indicative yield', () => {
  it('computes a 364-day bill yield', () => {
    // (100 − 88.5) / 88.5 × 365 / 364 × 100 = 13.03%
    expect(indicativeYield('88.50', { kind: 'bill', days: 364 })).toBe('13.03');
  });

  it('computes a bond yield approximation', () => {
    // (13.5 + 2/15) / 99 × 100 = 13.77%
    expect(indicativeYield('98.00', { kind: 'bond', years: 15, couponRate: '13.5' })).toBe('13.77');
  });

  it('has no yield for an invalid price', () => {
    expect(indicativeYield('0', { kind: 'bill', days: 91 })).toBeNull();
  });
});

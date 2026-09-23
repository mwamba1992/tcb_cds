import {
  add,
  compare,
  formatAmount,
  formatCompact,
  formatTzs,
  ratioOf,
  subtract,
  sum,
} from './money';

describe('money formatting', () => {
  it('renders whole shillings with grouping, as the design does', () => {
    expect(formatTzs('48500000.00')).toBe('TZS 48,500,000');
    expect(formatAmount('58200000000')).toBe('58,200,000,000');
  });

  it('shows cents only when asked', () => {
    expect(formatTzs('860625.50', { cents: true })).toBe('TZS 860,625.50');
  });

  it('puts negatives in parentheses so colour is never load-bearing', () => {
    expect(formatTzs('-5000.00')).toBe('(TZS 5,000)');
    expect(formatAmount('-5000')).toBe('(5,000)');
  });

  it('does not show negative zero', () => {
    expect(formatAmount('-0.00')).toBe('0');
  });

  it('compacts large figures for KPI tiles', () => {
    expect(formatCompact('86400000000')).toBe('86.4bn');
    expect(formatCompact('6450000')).toBe('6.5m');
    expect(formatCompact('950000')).toBe('950,000');
  });

  it('refuses numbers dressed as strings', () => {
    expect(() => formatTzs('1e9')).toThrow();
    expect(() => formatTzs('abc')).toThrow();
  });
});

describe('money arithmetic', () => {
  it('is exact where a double is not', () => {
    expect(add('0.10', '0.20')).toBe('0.30');
    expect(sum(['58200000000.01', '21700000000.02', '6450000000.03'])).toBe('86350000000.06');
  });

  it('subtracts and compares', () => {
    expect(subtract('6200000', '5005000')).toBe('1195000.00');
    expect(compare('5005000', '6200000')).toBe(-1);
  });

  it('gives bar-width ratios and survives a zero ceiling', () => {
    expect(ratioOf('23', '46')).toBe(0.5);
    expect(ratioOf('5', '0')).toBe(0);
  });
});

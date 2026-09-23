import { Money } from '@govsec/money';
import {
  BotAmountError,
  botAmountToMoney,
  botPriceToString,
  moneyToBotAmount,
  toBotPrice,
} from './amounts';

describe('BoT amount conversion', () => {
  it('turns whole shillings into Money exactly', () => {
    expect(botAmountToMoney(5_000_000).toString()).toBe('5000000.00');
  });

  it('refuses fractional, negative and unsafe amounts instead of rounding', () => {
    expect(() => botAmountToMoney(5_000_000.5)).toThrow(BotAmountError);
    expect(() => botAmountToMoney(-1)).toThrow(BotAmountError);
    expect(() => botAmountToMoney(2 ** 53)).toThrow(BotAmountError);
  });

  it('round-trips Money back to a BoT number', () => {
    expect(moneyToBotAmount(Money.parse('120000000000', 'TZS'))).toBe(120_000_000_000);
  });

  it('refuses to send cents to BoT', () => {
    expect(() => moneyToBotAmount(Money.parse('500000.50', 'TZS'))).toThrow(BotAmountError);
  });

  it('refuses a currency BoT does not settle in', () => {
    expect(() => moneyToBotAmount(Money.parse('100', 'USD'))).toThrow(BotAmountError);
  });
});

describe('BoT price conversion', () => {
  it('reads a numeric price without float noise', () => {
    expect(botPriceToString(99.5)).toBe('99.5');
    expect(botPriceToString(98.75)).toBe('98.75');
  });

  it('formats a request price with two decimals', () => {
    expect(toBotPrice('99.5')).toBe('99.50');
    expect(toBotPrice('100')).toBe('100.00');
    expect(toBotPrice('98.8500')).toBe('98.85');
  });

  it('refuses a price that would need rounding', () => {
    expect(() => toBotPrice('98.855')).toThrow(BotAmountError);
  });

  it('refuses things that are not prices', () => {
    expect(() => botPriceToString('abc')).toThrow(BotAmountError);
    expect(() => botPriceToString(-1)).toThrow(BotAmountError);
  });
});

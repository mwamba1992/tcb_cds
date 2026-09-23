import { Money } from '@govsec/money';

/**
 * Conversion between BoT's wire numbers and our Money / decimal strings.
 *
 * BoT sends amounts and prices as JSON numbers (Appendix B, B12). A JSON number is a
 * double, so this is the one place in the platform where a double is allowed to exist
 * — briefly, and only to be checked and converted. Nothing outside bot-gateway ever
 * holds a BoT amount as a number.
 *
 * Amounts are face value in whole shillings. A fractional or unsafe amount is refused
 * rather than rounded: rounding a securities amount is a business decision, and one
 * that belongs to a person, not to a parser.
 */

export class BotAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotAmountError';
  }
}

/** BoT amount (whole TZS, JSON number) → Money. */
export function botAmountToMoney(amount: number): Money {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new BotAmountError(
      `BoT amount must be a non-negative whole number of shillings, got ${amount}`,
    );
  }
  return Money.fromMinor(BigInt(amount) * 100n, 'TZS');
}

/** Money → BoT amount. Refuses cents and anything a double cannot hold exactly. */
export function moneyToBotAmount(money: Money): number {
  if (money.currency !== 'TZS') {
    throw new BotAmountError(`BoT amounts are TZS, got ${money.currency}`);
  }
  if (money.isNegative() || money.minorUnits % 100n !== 0n) {
    throw new BotAmountError(`BoT amounts are whole shillings, got ${money.toString()}`);
  }
  const shillings = money.minorUnits / 100n;
  if (shillings > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BotAmountError(
      `Amount ${money.toString()} exceeds what BoT's JSON number can carry exactly`,
    );
  }
  return Number(shillings);
}

const PRICE = /^\d{1,3}(\.\d{1,4})?$/;

/**
 * A price per 100 face value, as a decimal string.
 *
 * From BoT it arrives as a number (99.5); `String()` gives the shortest decimal that
 * round-trips, which for a price quoted to at most four places is the price itself.
 */
export function botPriceToString(price: number | string): string {
  const text = typeof price === 'number' ? String(price) : price.trim();
  if (!PRICE.test(text)) {
    throw new BotAmountError(`Not a valid price per 100: ${price}`);
  }
  return text;
}

/** A price string for a BoT request, fixed to two decimals as the spec's examples are. */
export function toBotPrice(price: string): string {
  const text = botPriceToString(price);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new BotAmountError(`BoT prices carry two decimals; ${price} would need rounding`);
  }
  return `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}`;
}

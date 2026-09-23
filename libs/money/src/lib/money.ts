/**
 * Money for the GovSec platform.
 *
 * Bid amounts, funds holds, settlement debits and coupon payouts are all money.
 * TypeScript has no native `decimal`: its `number` is an IEEE-754 double, so
 * `0.1 + 0.2 === 0.30000000000000004`. A ledger built on that drifts, and TAD §7.4 requires every hold, debit and settlement to reconcile.
 *
 * So money never exists as a `number` anywhere in this codebase. It is a `bigint`
 * count of minor units (senti for TZS) wrapped in a type that refuses to mix
 * currencies. Postgres keeps NUMERIC as specified; conversion happens only at the
 * database and transport edges.
 */

export type CurrencyCode = 'TZS' | 'USD' | 'KES' | 'UGX';

/** Minor units per major unit, as a power of ten. */
const CURRENCY_EXPONENT: Record<CurrencyCode, number> = {
  TZS: 2,
  USD: 2,
  KES: 2,
  UGX: 2,
};

export class CurrencyMismatchError extends Error {
  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(`Cannot combine ${left} with ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

function exponentOf(currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENT[currency];
  if (exponent === undefined) {
    throw new InvalidMoneyError(`Unsupported currency: ${currency}`);
  }
  return exponent;
}

export class Money {
  private constructor(
    /** Signed count of minor units. Negative means a debit. */
    readonly minorUnits: bigint,
    readonly currency: CurrencyCode,
  ) {}

  // --- construction ---------------------------------------------------------

  /** Build from a raw minor-unit count, e.g. `Money.fromMinor(1_500_000n, 'TZS')`. */
  static fromMinor(minorUnits: bigint, currency: CurrencyCode): Money {
    exponentOf(currency);
    return new Money(minorUnits, currency);
  }

  /**
   * Parse a decimal string such as "15000.00". Deliberately accepts only a string:
   * taking a `number` here would reintroduce float error at the boundary, which is
   * exactly the bug this class exists to prevent.
   */
  static parse(value: string, currency: CurrencyCode): Money {
    const exponent = exponentOf(currency);
    const trimmed = value.trim();

    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) {
      throw new InvalidMoneyError(`Not a valid decimal amount: "${value}"`);
    }

    const [, sign, whole = '0', fraction = ''] = match;
    if (fraction.length > exponent) {
      throw new InvalidMoneyError(
        `${currency} supports ${exponent} decimal places, got "${value}". ` +
          `Rounding must be an explicit decision, not a side effect of parsing.`,
      );
    }

    const padded = fraction.padEnd(exponent, '0');
    const magnitude = BigInt(whole + padded);
    return new Money(sign === '-' ? -magnitude : magnitude, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  // --- arithmetic -----------------------------------------------------------

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  /** Multiply by a whole number, e.g. a line-item quantity. */
  multiply(factor: bigint | number): Money {
    if (typeof factor === 'number' && !Number.isInteger(factor)) {
      throw new InvalidMoneyError(
        `multiply() takes whole numbers only; use allocate() or percentage() for ` +
          `fractional splits so no minor unit is lost to rounding.`,
      );
    }
    return new Money(this.minorUnits * BigInt(factor), this.currency);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  abs(): Money {
    return new Money(this.minorUnits < 0n ? -this.minorUnits : this.minorUnits, this.currency);
  }

  /**
   * Split into `parts` shares whose sum is exactly this amount. Remainder minor units
   * are distributed one each to the leading shares, so a 3-way split of 100.00 gives
   * 33.34 / 33.33 / 33.33 rather than losing a cent. Needed wherever a fee or
   * a pro-rata allotment is split.
   */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new InvalidMoneyError(`allocate() needs a positive integer, got ${parts}`);
    }
    const divisor = BigInt(parts);
    const base = this.minorUnits / divisor;
    let remainder = this.minorUnits - base * divisor;
    const step = remainder < 0n ? -1n : 1n;

    const shares: Money[] = [];
    for (let index = 0; index < parts; index += 1) {
      let share = base;
      if (remainder !== 0n) {
        share += step;
        remainder -= step;
      }
      shares.push(new Money(share, this.currency));
    }
    return shares;
  }

  // --- comparison -----------------------------------------------------------

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits > other.minorUnits;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  // --- edges ----------------------------------------------------------------

  /** Decimal string for Postgres NUMERIC and for API responses. */
  toString(): string {
    const exponent = exponentOf(this.currency);
    const negative = this.minorUnits < 0n;
    const digits = (negative ? -this.minorUnits : this.minorUnits)
      .toString()
      .padStart(exponent + 1, '0');
    const whole = digits.slice(0, digits.length - exponent);
    const fraction = digits.slice(digits.length - exponent);
    const body = exponent === 0 ? whole : `${whole}.${fraction}`;
    return negative ? `-${body}` : body;
  }

  /** Serialises as a string, never a JSON number — JSON numbers are doubles too. */
  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.toString(), currency: this.currency };
  }

  format(): string {
    return `${this.currency} ${this.toString()}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

import Big from 'big.js';

/**
 * Money in the portal is always a decimal string off the wire — `"5005000.00"`.
 *
 * Nothing here returns a `number` for a currency value. A TZS figure in the tens of
 * billions (an auction's face value) is well past the point where a double drifts, and
 * a bank's portal that disagrees with its own ledger by a shilling is a support case.
 * Arithmetic goes through Big.js; display goes through string grouping.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;

function assertDecimal(value: string): void {
  if (!DECIMAL.test(String(value).trim())) {
    throw new Error(`Not a decimal money string: ${JSON.stringify(value)}`);
  }
}

/** Groups digits from the right: `"1250000"` → `"1,250,000"`. */
function group(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - i;
    out += digits[i];
    if (fromRight > 1 && fromRight % 3 === 1) out += ',';
  }
  return out;
}

interface Parts {
  negative: boolean;
  whole: string;
  fraction: string;
}

function parts(value: string): Parts {
  assertDecimal(value);
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  return {
    negative: negative && /[1-9]/.test(unsigned),
    whole: group(whole.replace(/^0+(?=\d)/, '')),
    fraction: fraction.padEnd(2, '0').slice(0, 2),
  };
}

export interface FormatOptions {
  /** Show cents. The design shows whole shillings everywhere; statements may not. */
  cents?: boolean;
}

/** `TZS 5,005,000` — the canonical rendering. Negative amounts use parentheses. */
export function formatTzs(value: string, options: FormatOptions = {}): string {
  const body = `TZS ${formatAmount(value, options)}`;
  return body.startsWith('TZS (') ? `(TZS ${body.slice(5, -1)})` : body;
}

/** `5,005,000` — for a column whose header already says TZS. */
export function formatAmount(value: string, options: FormatOptions = {}): string {
  const { negative, whole, fraction } = parts(value);
  const body = options.cents ? `${whole}.${fraction}` : whole;
  return negative ? `(${body})` : body;
}

/** `58.2bn`, `6.5m` — for KPI tiles where the exact figure is a click away. */
export function formatCompact(value: string): string {
  assertDecimal(value);
  const amount = new Big(value);
  const abs = amount.abs();
  if (abs.gte('1e9')) return `${amount.div('1e9').toFixed(1)}bn`;
  if (abs.gte('1e6')) return `${amount.div('1e6').toFixed(1)}m`;
  return formatAmount(value);
}

export function add(left: string, right: string): string {
  assertDecimal(left);
  assertDecimal(right);
  return new Big(left).plus(right).toFixed(2);
}

export function subtract(left: string, right: string): string {
  assertDecimal(left);
  assertDecimal(right);
  return new Big(left).minus(right).toFixed(2);
}

export function sum(values: readonly string[]): string {
  return values
    .reduce((total, value) => {
      assertDecimal(value);
      return total.plus(value);
    }, new Big(0))
    .toFixed(2);
}

export function compare(left: string, right: string): -1 | 0 | 1 {
  assertDecimal(left);
  assertDecimal(right);
  return new Big(left).cmp(right) as -1 | 0 | 1;
}

/**
 * A unitless 0–1 ratio, for bar widths only. It is never displayed as money, which is
 * the only reason a `number` is allowed out of this file.
 */
export function ratioOf(value: string, max: string): number {
  assertDecimal(value);
  assertDecimal(max);
  const ceiling = new Big(max);
  if (ceiling.eq(0)) return 0;
  return Number(new Big(value).div(ceiling).toFixed(6));
}

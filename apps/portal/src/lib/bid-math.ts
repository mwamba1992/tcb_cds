import Big from 'big.js';

/**
 * The figures the bid screen shows while the investor types.
 *
 * Everything here is a **preview**. The auction service recomputes the commission and
 * the funds hold when the bid is submitted, and its figures are the ones held on the
 * account (TAD §5.2). The portal must never send a hold amount it calculated itself.
 *
 * The rules themselves — minimum, multiple, commission rate — arrive with the auction
 * from the API rather than living here, so TCB can change them in settings without a
 * portal release.
 */

export interface BidRules {
  /** Decimal string, whole shillings. */
  minimumBid: string;
  /** Decimal string; the face value must be a multiple of this. */
  bidMultiple: string;
  /** Commission in basis points of face value, e.g. 10 = 0.10%. */
  commissionBps: number;
}

export type Instrument =
  | { kind: 'bill'; days: number }
  | { kind: 'bond'; years: number; couponRate: string };

/** Digits only, from whatever the investor typed ("10,000,000" → "10000000"). */
export function digitsOnly(input: string): string {
  return input.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
}

/** Groups digits while typing: "10000000" → "10,000,000". */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type AmountProblem = 'empty' | 'below-minimum' | 'not-multiple';

export function amountProblem(faceValue: string, rules: BidRules): AmountProblem | null {
  if (!/^\d+$/.test(faceValue) || faceValue === '0') return 'empty';
  const amount = new Big(faceValue);
  if (amount.lt(rules.minimumBid)) return 'below-minimum';
  if (!amount.mod(rules.bidMultiple).eq(0)) return 'not-multiple';
  return null;
}

/**
 * A price per 100 face value, as BoT accepts it: above 0, at most 110, at most two
 * decimals (TAD Appendix B; @govsec/bot-client refuses anything finer).
 */
export function isValidPrice(price: string): boolean {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(price)) return false;
  const value = new Big(price);
  return value.gt(0) && value.lte(110);
}

export function commission(faceValue: string, rules: BidRules): string {
  return new Big(faceValue)
    .times(rules.commissionBps)
    .div(10_000)
    .round(2, Big.roundHalfUp)
    .toFixed(2);
}

/** What is held on the settlement account: the full face value plus commission. */
export function fundsHold(faceValue: string, rules: BidRules): string {
  return new Big(faceValue).plus(commission(faceValue, rules)).toFixed(2);
}

/** Estimated cash to settle a competitive bid: face × price / 100. */
export function settlementEstimate(faceValue: string, price: string): string {
  return new Big(faceValue).times(price).div(100).round(2, Big.roundHalfUp).toFixed(2);
}

/**
 * Indicative yield for a price, as a percentage string with two decimals.
 *
 * Bills: simple discount yield on an actual/365 basis, (100 − P) / P × 365 / days.
 * Bonds: the conventional approximation, (coupon + (100 − P) / years) / ((100 + P) / 2).
 *
 * "Indicative" is the operative word: BoT's own yield convention governs the auction,
 * and TCB must confirm which one the investor should see (design review, rule table).
 */
export function indicativeYield(price: string, instrument: Instrument): string | null {
  if (!isValidPrice(price)) return null;
  const p = new Big(price);
  let result: Big;
  if (instrument.kind === 'bill') {
    result = new Big(100).minus(p).div(p).times(365).div(instrument.days).times(100);
  } else {
    const pull = new Big(100).minus(p).div(instrument.years);
    const average = new Big(100).plus(p).div(2);
    result = new Big(instrument.couponRate).plus(pull).div(average).times(100);
  }
  return result.round(2, Big.roundHalfUp).toFixed(2);
}

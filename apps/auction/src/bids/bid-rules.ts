import { Money } from '@govsec/money';

/**
 * The arithmetic and rules of a bid, kept free of I/O so each can be tested alone.
 *
 * Money: face value is whole shillings (BoT's unit); price is per 100 of face value
 * with two decimals, carried as hundredths so nothing is ever a float.
 */

export interface BiddingRules {
  botCloseTime: string;
  cutoffHoursBeforeBot: number;
  commissionBps: number;
  minimumBill: number;
  minimumBond: number;
  bidMultiple: number;
}

const EAT_OFFSET_MS = 3 * 3_600_000;

/** BoT's close on the auction date, HH:MM EAT (fixed UTC+3, no daylight saving). */
export function botCloseAt(auctionDate: Date, closeTime: string): Date {
  const [h, m] = closeTime.split(':').map(Number);
  const utcMidnight = Date.UTC(auctionDate.getUTCFullYear(), auctionDate.getUTCMonth(), auctionDate.getUTCDate());
  return new Date(utcMidnight + ((h ?? 0) * 60 + (m ?? 0)) * 60_000 - EAT_OFFSET_MS);
}

export function tcbCutoffAt(botClose: Date, hoursBefore: number): Date {
  return new Date(botClose.getTime() - hoursBefore * 3_600_000);
}

export function minimumBid(instrument: string, rules: BiddingRules): number {
  return instrument === 'bond' ? rules.minimumBond : rules.minimumBill;
}

export type FaceValueProblem = 'not_whole' | 'below_minimum' | 'not_multiple';

export function faceValueProblem(faceValue: string, instrument: string, rules: BiddingRules): FaceValueProblem | null {
  if (!/^[1-9]\d{0,14}$/.test(faceValue)) return 'not_whole';
  const value = BigInt(faceValue);
  if (value < BigInt(minimumBid(instrument, rules))) return 'below_minimum';
  if (value % BigInt(rules.bidMultiple) !== 0n) return 'not_multiple';
  return null;
}

/** "88.5" or "88.50" → 8850; null when malformed or out of range (0 < price < 200). */
export function priceToHundredths(price: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(price)) return null;
  const [whole = '0', frac = ''] = price.split('.');
  const hundredths = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return hundredths > 0 && hundredths < 20_000 ? hundredths : null;
}

export function hundredthsToPrice(hundredths: number): string {
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/**
 * What to hold on the investor's account, in TZS minor units:
 * the cost of the securities plus commission on face value.
 *
 * Competitive: face × price / 100. Non-competitive: the price is not known until BoT
 * publishes the weighted average, so the full face value is held — the price of a
 * bill or bond at auction is almost never above par, and holding par means the
 * allotment can always be paid.
 */
export function holdMinor(faceValue: bigint, priceHundredths: number | null, commissionBps: number): bigint {
  // face (TZS) × price/100 → TZS; ×100 for cents: face × hundredths / 100 cents.
  const cost = priceHundredths === null ? faceValue * 100n : (faceValue * BigInt(priceHundredths)) / 100n;
  // face × bps / 10,000 TZS → ×100 cents: face × bps / 100.
  const commission = (faceValue * BigInt(commissionBps)) / 100n;
  return cost + commission;
}

export function tzs(minor: bigint): string {
  return Money.fromMinor(minor, 'TZS').toString();
}

/** BoT's batch reference: PARTICIP-YYMMDD-NNN, dated in EAT. */
export function batchReference(participantCode: string, date: Date, sequence: number): string {
  const eat = new Date(date.getTime() + EAT_OFFSET_MS);
  const yymmdd = `${String(eat.getUTCFullYear()).slice(2)}${String(eat.getUTCMonth() + 1).padStart(2, '0')}${String(eat.getUTCDate()).padStart(2, '0')}`;
  return `${participantCode}-${yymmdd}-${String(sequence).padStart(3, '0')}`;
}

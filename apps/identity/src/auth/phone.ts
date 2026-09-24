/**
 * Tanzanian mobile numbers, normalised at the edge to E.164 (+255XXXXXXXXX).
 *
 * People type 0712 345 678, 255712345678 or +255 712 345 678; all three must land on
 * one account, or a customer registers twice and their holdings split. Only mobile
 * ranges (6x, 7x) are accepted: a landline cannot receive the OTP.
 */
const TZ_MOBILE = /^\+255[67]\d{8}$/;

export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  let e164: string;
  if (digits.startsWith('+')) e164 = digits;
  else if (digits.startsWith('255')) e164 = `+${digits}`;
  else if (digits.startsWith('0')) e164 = `+255${digits.slice(1)}`;
  else if (/^[67]\d{8}$/.test(digits)) e164 = `+255${digits}`;
  else return null;
  return TZ_MOBILE.test(e164) ? e164 : null;
}

/** Keeps full numbers out of logs — they are personal data. */
export function maskPhone(phoneNumber: string): string {
  if (phoneNumber.length <= 7) return '***';
  return `${phoneNumber.slice(0, 7)}***${phoneNumber.slice(-3)}`;
}

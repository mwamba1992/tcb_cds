/**
 * Human-readable reference numbers.
 *
 * Bids, settlements and payouts are UUIDs internally and stay that way — but a UUID is
 * not something an investor can read down a phone line to a TCB branch, or type into a
 * USSD menu. These references are what people quote.
 *
 * Three properties matter, and the third is the one usually missed:
 *
 *  1. **Unambiguous when spoken.** Crockford base32 drops I, L, O and U, so there is no
 *     0/O or 1/I confusion, and it normalises on the way back in — someone who writes
 *     "O" where the code has "0" still finds their bid.
 *  2. **Checksummed.** A mistyped character is rejected rather than silently looking up
 *     a different, real bid. Without this, "not found" is the *good* outcome; the bad
 *     one is finding somebody else's.
 *  3. **Not sequential.** `BD-00001`, `BD-00002` publishes auction volumes to anyone who
 *     bids twice. Random references leak nothing, and the database's unique constraint
 *     handles the collisions that randomness implies.
 *
 * These are *our* references. The batch reference BoT requires on POST /bids has its own
 * fixed format and lives in @govsec/bot-client.
 */

/**
 * A uniform random index below `bound`, from the Web Crypto CSPRNG.
 *
 * Web Crypto rather than node:crypto so the same code runs in services and in the
 * portal. Rejection sampling avoids modulo bias: 256 is not a multiple of 32's
 * neighbours in general, and a biased alphabet makes references easier to guess.
 */
function secureIndex(bound: number): number {
  const limit = 256 - (256 % bound);
  const byte = new Uint8Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(byte);
    const value = byte[0] ?? 0;
    if (value < limit) return value % bound;
  }
}

/** Crockford base32: no I, L, O or U — the characters people confuse when speaking. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * What each reference belongs to, so one can never be mistaken for another.
 *
 * Prefixes are drawn from the same unambiguous alphabet as the body. A prefix containing
 * O, I, L or U would be rewritten by the normaliser and then fail to recognise itself —
 * a bug that only shows up when a customer reads a code aloud.
 */
export const REFERENCE_PREFIX = {
  /** A bid as the investor sees it, on every channel. */
  bid: 'BD',
  /** A settlement of allotted securities against the investor's account. */
  settlement: 'ST',
  /** A coupon or redemption credited to the investor. */
  payout: 'PY',
  /** A customer complaint or service case. */
  complaint: 'CS',
  /** The investor's own number, quoted at a branch or to the contact centre. */
  investor: 'NV',
  /** A KYC review case in the back office. */
  kycCase: 'KY',
  /** A request to open a CDS account for an approved investor. */
  cdsRequest: 'CD',
  /** A request to Core Banking to open a TCB account for a new-to-bank investor. */
  accountOpening: 'AP',
} as const;

export type ReferenceKind = keyof typeof REFERENCE_PREFIX;

/** Body length before the check character. 7 chars ≈ 34 billion combinations. */
const BODY_LENGTH = 7;

/**
 * Generate a reference, e.g. `BD-9K4T7MQ2`.
 *
 * Uses a CSPRNG rather than Math.random: a guessable bid reference lets someone probe
 * for other people's bids, and support endpoints look up by reference.
 */
export function generateReference(kind: ReferenceKind): string {
  let body = '';
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    body += ALPHABET[secureIndex(ALPHABET.length)];
  }
  return `${REFERENCE_PREFIX[kind]}-${body}${checkCharacter(body)}`;
}

/**
 * Normalise what somebody typed or read out.
 *
 * Accepts lower case, missing hyphen, and the substitutions people actually make: O for
 * zero, I or L for one. This is the half of the design that makes the alphabet choice
 * worth anything — rejecting "bd-9k4t7mq2" because of its case would be its own kind of
 * failure.
 */
export function normaliseReference(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length < 3) return cleaned;

  // Substitutions apply to the body only. The prefix is a fixed token, not base32, and
  // rewriting its letters would corrupt the very thing used to identify the kind.
  const prefix = cleaned.slice(0, 2);
  // Only characters *outside* the alphabet are folded in. An earlier version mapped Q to
  // zero as well — but Q is a valid Crockford character, so roughly one reference in five
  // failed to validate the code it had just issued.
  const body = cleaned.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');

  return `${prefix}-${body}`;
}

/**
 * Is this a well-formed reference of the expected kind, with a valid check character?
 *
 * Called before any lookup. A reference that fails here never reaches the database, so a
 * typo cannot become a query.
 */
export function isValidReference(input: string, kind?: ReferenceKind): boolean {
  const normalised = normaliseReference(input);
  const match = /^([A-Z]{2})-([0-9A-Z]{8})$/.exec(normalised);
  if (!match) return false;

  const [, prefix, payload] = match;
  if (!prefix || !payload) return false;

  if (kind && prefix !== REFERENCE_PREFIX[kind]) return false;
  if (!Object.values(REFERENCE_PREFIX).includes(prefix as never)) return false;

  const body = payload.slice(0, BODY_LENGTH);
  const check = payload.slice(BODY_LENGTH);
  if ([...payload].some((character) => !ALPHABET.includes(character))) return false;

  return checkCharacter(body) === check;
}

export function referenceKind(input: string): ReferenceKind | null {
  const normalised = normaliseReference(input);
  const prefix = normalised.slice(0, 2);
  const found = Object.entries(REFERENCE_PREFIX).find(([, value]) => value === prefix);
  return (found?.[0] as ReferenceKind) ?? null;
}

/**
 * Position-weighted checksum over the body.
 *
 * Weighting by position is what catches a transposition — an unweighted sum gives
 * "9K4" and "4K9" the same check character, and transposing two characters is the second
 * most common thing a person does when copying a code down.
 */
function checkCharacter(body: string): string {
  let total = 0;
  for (let index = 0; index < body.length; index += 1) {
    const value = ALPHABET.indexOf(body[index] ?? '');
    if (value < 0) return '?';
    total += value * (index + 2);
  }
  return ALPHABET[total % ALPHABET.length] ?? '0';
}

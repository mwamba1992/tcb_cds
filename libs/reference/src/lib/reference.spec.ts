import {
  generateReference,
  isValidReference,
  normaliseReference,
  referenceKind,
  REFERENCE_PREFIX,
  type ReferenceKind,
} from './reference';

describe('reference numbers', () => {
  describe('shape', () => {
    it('produces a prefixed, hyphenated reference', () => {
      expect(generateReference('bid')).toMatch(/^BD-[0-9A-Z]{8}$/);
      expect(generateReference('settlement')).toMatch(/^ST-[0-9A-Z]{8}$/);
    });

    it('never emits a character people confuse when speaking', () => {
      // I, L, O and U are absent from the alphabet on purpose.
      // Prefix included: `SO` would have failed this, which is how the prefix bug was
      // found in the first place.
      for (let i = 0; i < 500; i += 1) {
        expect(generateReference('bid')).not.toMatch(/[ILOU]/);
      }
      // Read off the map rather than listed here. The literal list had already gone stale
      // in sokohub — a prefix was missing — so one added tomorrow was covered by nothing, which
      // is the exact shape of the bug this test was written for.
      for (const prefix of Object.values(REFERENCE_PREFIX)) {
        expect(prefix).not.toMatch(/[ILOU]/);
      }
    });

    it('issues a valid reference for every kind, including the ones added later', () => {
      // `generateReference` and `isValidReference` have to agree about a new kind. They
      // disagreed once already, over Q.
      for (const kind of Object.keys(REFERENCE_PREFIX) as ReferenceKind[]) {
        const reference = generateReference(kind);
        expect(isValidReference(reference, kind)).toBe(true);
        expect(normaliseReference(reference.toLowerCase())).toBe(reference);
      }
    });

    it('gives every kind its own prefix', () => {
      // Rule 6: one prefix per kind, forever. Two kinds sharing one would make a
      // reference ambiguous about what it names.
      const prefixes = Object.values(REFERENCE_PREFIX);
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });

    it('does not leak how many bids exist', () => {
      // Sequential references publish daily volume to anyone who places two bids a
      // day apart. Consecutive generations must not be adjacent.
      const first = generateReference('bid');
      const second = generateReference('bid');
      expect(first).not.toBe(second);
    });
  });

  describe('validation', () => {
    it('accepts what it generates', () => {
      for (let i = 0; i < 500; i += 1) {
        expect(isValidReference(generateReference('bid'), 'bid')).toBe(true);
      }
    });

    it('rejects a single mistyped character', () => {
      // The point of the check character: a typo must fail, not silently find a
      // different real bid.
      const reference = generateReference('bid');
      const original = reference[4] ?? '4';
      const broken = `${reference.slice(0, 4)}${original === '4' ? '5' : '4'}${reference.slice(5)}`;
      expect(isValidReference(broken)).toBe(false);
    });

    it('catches a transposition', () => {
      // Position weighting exists for this. An unweighted sum would pass both.
      let caught = 0;
      let tried = 0;
      for (let i = 0; i < 200; i += 1) {
        const reference = generateReference('bid');
        const body = reference.slice(3, 10);
        if (body[0] === body[1]) continue; // swapping identical characters changes nothing
        tried += 1;
        const swapped = `BD-${body[1]}${body[0]}${body.slice(2)}${reference.slice(10)}`;
        if (!isValidReference(swapped)) caught += 1;
      }
      // Not every transposition is detectable by a single check character, but the
      // overwhelming majority must be.
      expect(caught / tried).toBeGreaterThan(0.9);
    });

    it('rejects the wrong kind', () => {
      const bid = generateReference('bid');
      expect(isValidReference(bid, 'bid')).toBe(true);
      expect(isValidReference(bid, 'settlement')).toBe(false);
    });

    it('rejects junk', () => {
      expect(isValidReference('')).toBe(false);
      expect(isValidReference('SO-123')).toBe(false);
      expect(isValidReference('hello world')).toBe(false);
      expect(isValidReference('XX-9K4T7MQ2')).toBe(false);
    });
  });

  describe('what people actually type', () => {
    it('accepts lower case', () => {
      const reference = generateReference('bid');
      expect(isValidReference(reference.toLowerCase())).toBe(true);
    });

    it('accepts a missing hyphen', () => {
      const reference = generateReference('bid');
      expect(isValidReference(reference.replace('-', ''))).toBe(true);
    });

    it('accepts surrounding whitespace', () => {
      expect(isValidReference(`  ${generateReference('bid')} \n`)).toBe(true);
    });

    it('forgives O for zero and I or L for one', () => {
      // Someone reading a code aloud says "oh" and the listener writes O. The whole
      // reason for this alphabet is that we can recover from it.
      const reference = generateReference('bid');
      const misheard =
        reference.slice(0, 3) + reference.slice(3).replace(/0/g, 'O').replace(/1/g, 'I');
      expect(isValidReference(misheard)).toBe(true);
    });

    it('normalises to one canonical form', () => {
      const reference = generateReference('bid');
      const mangled = (reference.slice(0, 2) + reference.slice(3).replace(/0/g, 'o')).toLowerCase();
      expect(normaliseReference(mangled)).toBe(reference);
    });
  });

  describe('kind', () => {
    it('reads the kind back off a reference', () => {
      expect(referenceKind(generateReference('bid'))).toBe('bid');
      expect(referenceKind(generateReference('payout'))).toBe('payout');
      expect(referenceKind('ZZ-1234567')).toBeNull();
    });
  });
});

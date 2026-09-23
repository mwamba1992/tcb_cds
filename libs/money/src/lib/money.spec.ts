import { CurrencyMismatchError, InvalidMoneyError, Money } from './money';

describe('Money', () => {
  describe('the float bug it exists to prevent', () => {
    it('adds repeated fractional amounts without drift', () => {
      // 0.1 + 0.2 !== 0.3 in IEEE-754. Here it must be exact.
      const sum = Money.parse('0.10', 'TZS').add(Money.parse('0.20', 'TZS'));
      expect(sum.toString()).toBe('0.30');
    });

    it('stays exact across many additions', () => {
      let total = Money.zero('TZS');
      for (let i = 0; i < 1000; i += 1) {
        total = total.add(Money.parse('0.01', 'TZS'));
      }
      expect(total.toString()).toBe('10.00');
    });

    it('refuses to parse a float-shaped number', () => {
      // @ts-expect-error a number must not be accepted at the boundary
      expect(() => Money.parse(15000.5, 'TZS')).toThrow();
    });
  });

  describe('parse', () => {
    it('reads a plain decimal string', () => {
      expect(Money.parse('15000.00', 'TZS').minorUnits).toBe(1_500_000n);
    });

    it('accepts a whole number with no decimal point', () => {
      expect(Money.parse('15000', 'TZS').minorUnits).toBe(1_500_000n);
    });

    it('handles negatives', () => {
      expect(Money.parse('-250.75', 'TZS').minorUnits).toBe(-25_075n);
    });

    it('rejects excess precision rather than silently rounding', () => {
      expect(() => Money.parse('10.005', 'TZS')).toThrow(InvalidMoneyError);
    });

    it('rejects junk', () => {
      expect(() => Money.parse('abc', 'TZS')).toThrow(InvalidMoneyError);
      expect(() => Money.parse('', 'TZS')).toThrow(InvalidMoneyError);
      expect(() => Money.parse('1.2.3', 'TZS')).toThrow(InvalidMoneyError);
    });
  });

  describe('currency safety', () => {
    it('refuses to add different currencies', () => {
      expect(() => Money.parse('100.00', 'TZS').add(Money.parse('100.00', 'USD'))).toThrow(
        CurrencyMismatchError,
      );
    });

    it('treats equal amounts in different currencies as unequal', () => {
      expect(Money.parse('100.00', 'TZS').equals(Money.parse('100.00', 'USD'))).toBe(false);
    });
  });

  describe('multiply', () => {
    it('scales by a line-item quantity', () => {
      // 2 × 15,000.00 = 30,000.00
      expect(Money.parse('15000.00', 'TZS').multiply(2).toString()).toBe('30000.00');
    });

    it('refuses fractional factors, which would round invisibly', () => {
      expect(() => Money.parse('100.00', 'TZS').multiply(0.15)).toThrow(InvalidMoneyError);
    });
  });

  describe('allocate', () => {
    it('splits without losing a minor unit', () => {
      const shares = Money.parse('100.00', 'TZS').allocate(3);
      expect(shares.map((s) => s.toString())).toEqual(['33.34', '33.33', '33.33']);

      const rebuilt = shares.reduce((acc, s) => acc.add(s), Money.zero('TZS'));
      expect(rebuilt.toString()).toBe('100.00');
    });

    it('conserves the total for any split', () => {
      const original = Money.parse('30000.01', 'TZS');
      for (let parts = 1; parts <= 7; parts += 1) {
        const total = original.allocate(parts).reduce((acc, s) => acc.add(s), Money.zero('TZS'));
        expect(total.equals(original)).toBe(true);
      }
    });

    it('conserves the total for negative amounts too', () => {
      const original = Money.parse('-100.00', 'TZS');
      const total = original.allocate(3).reduce((acc, s) => acc.add(s), Money.zero('TZS'));
      expect(total.equals(original)).toBe(true);
    });

    it('rejects a non-positive part count', () => {
      expect(() => Money.parse('10.00', 'TZS').allocate(0)).toThrow(InvalidMoneyError);
    });
  });

  describe('serialisation', () => {
    it('round-trips through its string form', () => {
      const original = Money.parse('123456.78', 'TZS');
      expect(Money.parse(original.toString(), 'TZS').equals(original)).toBe(true);
    });

    it('pads amounts below one major unit', () => {
      expect(Money.fromMinor(5n, 'TZS').toString()).toBe('0.05');
      expect(Money.fromMinor(0n, 'TZS').toString()).toBe('0.00');
    });

    it('serialises the amount as a string, never a JSON number', () => {
      const encoded = JSON.parse(JSON.stringify(Money.parse('30000.00', 'TZS')));
      expect(encoded).toEqual({ amount: '30000.00', currency: 'TZS' });
      expect(typeof encoded.amount).toBe('string');
    });
  });
});

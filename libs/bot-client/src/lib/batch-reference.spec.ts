import {
  BatchReferenceError,
  formatBatchReference,
  isValidBatchReference,
  parseBatchReference,
} from './batch-reference';

describe('BoT batch reference', () => {
  it('formats code, Tanzanian date and sequence as the spec requires', () => {
    // 22:30 UTC on 25 July is already 26 July in Dar es Salaam (UTC+3).
    const date = new Date('2026-07-25T22:30:00Z');
    expect(formatBatchReference('corptztz', date, 1)).toBe('CORPTZTZ-260726-001');
  });

  it('accepts the example from the spec', () => {
    expect(isValidBatchReference('CORPTZTZ-270726-001')).toBe(true);
  });

  it('rejects malformed references before BoT has to', () => {
    expect(isValidBatchReference('CORPTZ-270726-001')).toBe(false);
    expect(isValidBatchReference('CORPTZTZ-271326-001')).toBe(false);
    expect(isValidBatchReference('CORPTZTZ-270726-000')).toBe(false);
    expect(isValidBatchReference('corptztz-270726-001')).toBe(false);
  });

  it('refuses a participant code of the wrong length', () => {
    expect(() => formatBatchReference('TCB', new Date(), 1)).toThrow(BatchReferenceError);
  });

  it('refuses a sequence the three-digit field cannot hold', () => {
    expect(() => formatBatchReference('CORPTZTZ', new Date(), 0)).toThrow(BatchReferenceError);
    expect(() => formatBatchReference('CORPTZTZ', new Date(), 1000)).toThrow(BatchReferenceError);
  });

  it('parses back into its parts', () => {
    expect(parseBatchReference('CORPTZTZ-270726-042')).toEqual({
      participantCode: 'CORPTZTZ',
      date: '2027-07-26',
      sequence: 42,
    });
    expect(parseBatchReference('nonsense')).toBeNull();
  });
});

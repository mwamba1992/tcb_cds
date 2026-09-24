import { compareNames, normaliseName, screeningScore } from './names';

describe('names', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normaliseName("  Asha  Juma-Mussa. ")).toBe('ASHA JUMA MUSSA');
    expect(normaliseName('Zoë N’gwala')).toBe('ZOE NGWALA');
  });

  it('treats the same names in another order as exact', () => {
    expect(compareNames('Mussa Asha Juma', 'ASHA JUMA MUSSA')).toBe('exact');
  });

  it('treats initials and a missing middle name as close', () => {
    expect(compareNames('JUMA HASSAN MWINYI', 'JUMA H. MWINYI')).toBe('close');
    expect(compareNames('Juma Mwinyi', 'JUMA HASSAN MWINYI')).toBe('close');
  });

  it('treats a different surname as different', () => {
    expect(compareNames('JUMA HASSAN MWINYI', 'JUMA HASSAN KIBWANA')).toBe('different');
  });

  it('does not call one shared first name close', () => {
    expect(compareNames('Juma', 'JUMA HASSAN MWINYI')).toBe('different');
  });

  it('scores screening against the listed name', () => {
    expect(screeningScore('Ali Omar Said', 'ALI OMAR SAYED')).toBe(1);
    expect(screeningScore('Ali Mwinyi', 'ALI OMAR SAYED')).toBeCloseTo(1 / 3);
  });
});

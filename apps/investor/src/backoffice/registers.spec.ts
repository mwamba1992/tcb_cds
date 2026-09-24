import { maskNida } from './registers.service';

describe('maskNida', () => {
  it('keeps the first and last four digits only', () => {
    expect(maskNida('19900521131050000137')).toBe('1990••••••••••••0137');
    expect(maskNida(null)).toBeNull();
  });
});

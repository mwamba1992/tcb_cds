import { maskPhone, normalisePhone } from './phone';

describe('normalisePhone', () => {
  it.each([
    ['0712345678', '+255712345678'],
    ['0712 345 678', '+255712345678'],
    ['255712345678', '+255712345678'],
    ['+255 712-345-678', '+255712345678'],
    ['712345678', '+255712345678'],
    ['0655123456', '+255655123456'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    ['0222123456', 'a landline cannot receive the OTP'],
    ['+254712345678', 'Kenyan'],
    ['07123456', 'too short'],
    ['07123456789', 'too long'],
    ['abc', 'not a number'],
  ])('refuses %s (%s)', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it('masks all but the prefix and last three digits', () => {
    expect(maskPhone('+255712345678')).toBe('+255712***678');
  });
});

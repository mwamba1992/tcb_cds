import { pinProblem } from './pin-policy';

describe('pinProblem', () => {
  it.each(['4827', '9130', '5071'])('accepts %s', (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });

  it.each([
    ['123', 'format'],
    ['12345', 'format'],
    ['12a4', 'format'],
    ['7777', 'repeated'],
    ['3456', 'sequential'],
    ['8765', 'sequential'],
    ['1212', 'common'],
    ['2580', 'common'],
  ])('refuses %s as %s', (pin, problem) => {
    expect(pinProblem(pin)).toBe(problem);
  });
});

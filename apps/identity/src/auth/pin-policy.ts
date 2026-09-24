/**
 * What makes a transaction PIN acceptable.
 *
 * Four digits is only 10,000 combinations, and people choose a small corner of them.
 * The lockout bounds online guessing; this list removes the choices an attacker tries
 * first, so the five guesses the lockout allows are not the five most likely PINs.
 */
export const PIN_LENGTH = 4;

const COMMON = new Set(['1234', '4321', '0000', '1111', '1212', '2580', '0852', '1004', '2000', '6969']);

export type PinProblem = 'format' | 'repeated' | 'sequential' | 'common';

export function pinProblem(pin: string): PinProblem | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return 'format';
  if (new Set(pin).size === 1) return 'repeated';
  if (isRun(pin, 1) || isRun(pin, -1)) return 'sequential';
  if (COMMON.has(pin)) return 'common';
  return null;
}

export const PIN_PROBLEM_MESSAGE: Record<PinProblem, string> = {
  format: `PIN must be ${PIN_LENGTH} digits`,
  repeated: 'PIN cannot be one digit repeated',
  sequential: 'PIN cannot be a run of digits like 1234 or 9876',
  common: 'PIN is too commonly used; choose another',
};

function isRun(pin: string, step: 1 | -1): boolean {
  for (let i = 1; i < pin.length; i += 1) {
    if (Number(pin[i]) !== Number(pin[i - 1]) + step) return false;
  }
  return true;
}

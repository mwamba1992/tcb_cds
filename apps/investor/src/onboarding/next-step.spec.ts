import { nextStep } from './onboarding.service';

describe('nextStep', () => {
  it('walks the journey', () => {
    expect(nextStep('draft', 'none', false, false)).toBe('profile');
    expect(nextStep('draft', 'none', true, false)).toBe('submit');
    expect(nextStep('under_review', 'none', true, false)).toBe('under_review');
    expect(nextStep('info_requested', 'none', true, false)).toBe('provide_info');
    expect(nextStep('approved', 'requested', true, true)).toBe('awaiting_cds');
    expect(nextStep('approved', 'active', true, true)).toBe('ready');
    expect(nextStep('rejected', 'none', true, false)).toBe('rejected');
  });

  it('is not ready while a new-to-bank investor waits for their TCB account', () => {
    expect(nextStep('approved', 'active', true, false)).toBe('awaiting_bank');
  });
});

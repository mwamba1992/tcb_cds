import type { CheckResult } from './check-result';
import { checkAgainstNida, dateFromNin, StubNidaRegistry } from './nida';
import { canAutoApprove, rateRisk } from './risk';
import { screen, StubScreeningLists } from './screening';

describe('NIDA check', () => {
  const registry = new StubNidaRegistry();

  it('reads the date of birth a NIN starts with, and refuses impossible dates', () => {
    expect(dateFromNin('19900521131050000137')).toBe('1990-05-21');
    expect(dateFromNin('19900231131050000137')).toBeNull();
    expect(dateFromNin('1990052113105')).toBeNull();
  });

  it('is clear when name and date agree', async () => {
    const nin = '19900521131050000137';
    const result = checkAgainstNida(
      { fullName: 'Asha Juma Mussa', dateOfBirth: '1990-05-21', nidaNumber: nin },
      await registry.lookup(nin),
    );
    expect(result.outcome).toBe('clear');
  });

  it('asks for review when the name differs, and says why', async () => {
    const nin = '19860314112030000124';
    const result = checkAgainstNida(
      { fullName: 'Juma Mwinyi', dateOfBirth: '1986-03-14', nidaNumber: nin },
      await registry.lookup(nin),
    );
    expect(result).toMatchObject({ outcome: 'review', reasons: ['Declared name differs from NIDA'] });
  });

  it('catches a date of birth that is not the one in the NIN', async () => {
    const nin = '19950101120010000999';
    const result = checkAgainstNida(
      { fullName: 'Neema Kweka', dateOfBirth: '1995-01-02', nidaNumber: nin },
      await registry.lookup(nin),
    );
    expect(result.reasons).toContain('Date of birth differs from NIDA');
  });
});

describe('screening', () => {
  const lists = new StubScreeningLists();

  it('flags a transliterated sanctions name', async () => {
    const result = screen('sanctions', 'Ali Omar Said', await lists.sanctions());
    expect(result.outcome).toBe('review');
    expect(result.reasons[0]).toMatch(/sanctions list match \(100%\)/);
  });

  it('clears an unrelated name', async () => {
    expect(screen('sanctions', 'Asha Juma Mussa', await lists.sanctions()).outcome).toBe('clear');
  });
});

describe('risk', () => {
  const clear = (source: CheckResult['source']): CheckResult => ({
    source,
    outcome: 'clear',
    reasons: [],
    details: {},
  });

  it('is low, and auto-approvable, when every check is clear', () => {
    const checks = [clear('nida'), clear('cbs'), clear('sanctions'), clear('pep')];
    const { risk } = rateRisk({ checks, pepDeclared: false, sourceOfFunds: 'salary' });
    expect(risk).toBe('low');
    expect(canAutoApprove(checks, risk)).toBe(true);
  });

  it('is high for a declared PEP even with clean checks', () => {
    const result = rateRisk({ checks: [clear('nida')], pepDeclared: true, sourceOfFunds: 'salary' });
    expect(result).toEqual({ risk: 'high', reasons: ['Declared as a politically exposed person'] });
  });

  it('is medium for a name mismatch, and never auto-approves', () => {
    const checks: CheckResult[] = [
      { source: 'nida', outcome: 'review', reasons: ['Declared name differs from NIDA'], details: {} },
    ];
    const { risk } = rateRisk({ checks, pepDeclared: false, sourceOfFunds: 'salary' });
    expect(risk).toBe('medium');
    expect(canAutoApprove(checks, risk)).toBe(false);
  });

  it('never treats an unavailable source as clear', () => {
    const checks: CheckResult[] = [{ source: 'cbs', outcome: 'unavailable', reasons: [], details: {} }];
    expect(canAutoApprove(checks, rateRisk({ checks, pepDeclared: false, sourceOfFunds: 'salary' }).risk)).toBe(false);
  });
});

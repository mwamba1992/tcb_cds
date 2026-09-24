import type { CheckResult } from './check-result';

export type Risk = 'low' | 'medium' | 'high';

export interface RiskInput {
  checks: CheckResult[];
  pepDeclared: boolean;
  sourceOfFunds: string;
}

/**
 * The customer risk rating at onboarding (TAD §5.1).
 *
 * Deliberately simple and explainable: every rating comes with the reasons that set
 * it, because compliance has to be able to say why a customer is high risk. TCB's
 * AML policy may replace the rules; the shape — rating plus reasons — stays.
 */
export function rateRisk(input: RiskInput): { risk: Risk; reasons: string[] } {
  const high: string[] = [];
  const medium: string[] = [];

  for (const check of input.checks) {
    if (check.outcome === 'clear') continue;
    if (check.source === 'sanctions' || check.source === 'pep') high.push(...check.reasons);
    else if (check.outcome === 'unavailable') medium.push(`${check.source.toUpperCase()} check could not be completed`);
    else medium.push(...check.reasons);
  }
  if (input.pepDeclared) high.push('Declared as a politically exposed person');
  if (input.sourceOfFunds === 'other') medium.push('Source of funds given as "other"');

  if (high.length > 0) return { risk: 'high', reasons: [...high, ...medium] };
  if (medium.length > 0) return { risk: 'medium', reasons: medium };
  return { risk: 'low', reasons: [] };
}

/** Straight through only when nothing needs a person: every check clear, low risk. */
export function canAutoApprove(checks: CheckResult[], risk: Risk): boolean {
  return risk === 'low' && checks.every((check) => check.outcome === 'clear');
}

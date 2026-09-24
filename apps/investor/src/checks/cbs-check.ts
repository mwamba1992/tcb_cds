import type { CbsCustomerView } from '../clients/clients';
import type { CheckResult, FieldComparison } from './check-result';
import { compareNames } from './names';

export type BankLink =
  | { kind: 'existing'; customerId: string; account: string }
  | { kind: 'new_to_bank' }
  | { kind: 'unresolved' };

type Found = Extract<CbsCustomerView, { found: true }>;

/**
 * The investor against TCB's own records: is this person already a customer, and
 * which TZS account will fund their bids and receive their payouts?
 *
 * Compared with the NIDA record, not the declared details: NIDA is the authority on
 * who the person is, and Core Banking must agree with it.
 */
export function checkAgainstCbs(input: {
  nidaNumber: string;
  identity: { fullName: string; dateOfBirth: string };
  declaredAccount: string | null;
  byNida: CbsCustomerView;
  byAccount: CbsCustomerView | null;
}): CheckResult & { link: BankLink } {
  const reasons: string[] = [];
  const customer = input.byNida.found ? input.byNida : null;

  let account: string | null = null;
  if (input.declaredAccount) {
    const owner = input.byAccount?.found ? input.byAccount : null;
    if (!owner) reasons.push('Declared TCB account not found in Core Banking');
    else if (owner.nidaNumber !== input.nidaNumber) {
      reasons.push('Declared TCB account belongs to a different customer');
    } else {
      const held = owner.accounts.find((a) => a.number === input.declaredAccount);
      if (held?.status !== 'active' || held.currency !== 'TZS') {
        reasons.push('Declared TCB account is not an active TZS account');
      } else account = held.number;
    }
  }

  if (!customer) {
    return {
      source: 'cbs',
      outcome: reasons.length === 0 ? 'clear' : 'review',
      reasons,
      details: { newToBank: true, fields: [] },
      link: reasons.length === 0 ? { kind: 'new_to_bank' } : { kind: 'unresolved' },
    };
  }

  const name = compareNames(input.identity.fullName, customer.fullName);
  if (name !== 'exact') reasons.push('Name on NIDA does not match the Core Banking customer record');
  if (customer.dateOfBirth !== input.identity.dateOfBirth) {
    reasons.push('Date of birth on NIDA does not match Core Banking');
  }
  account ??= input.declaredAccount ? null : firstActiveTzs(customer);
  if (!account && !input.declaredAccount) reasons.push('Customer has no active TZS account');

  const fields: FieldComparison[] = [
    {
      label: 'Full name',
      a: input.identity.fullName,
      b: customer.fullName,
      result: name === 'exact' ? 'match' : 'mismatch',
    },
    {
      label: 'Date of birth',
      a: input.identity.dateOfBirth,
      b: customer.dateOfBirth,
      result: customer.dateOfBirth === input.identity.dateOfBirth ? 'match' : 'mismatch',
    },
    {
      label: 'NIDA number',
      a: input.nidaNumber,
      b: customer.nidaNumber,
      result: customer.nidaNumber === input.nidaNumber ? 'match' : 'mismatch',
    },
    { label: 'TCB account', a: input.declaredAccount ?? '—', b: account ?? '—', result: 'n/a' },
  ];

  return {
    source: 'cbs',
    outcome: reasons.length === 0 ? 'clear' : 'review',
    reasons,
    details: { newToBank: false, customerId: customer.customerId, fields },
    link: account ? { kind: 'existing', customerId: customer.customerId, account } : { kind: 'unresolved' },
  };
}

function firstActiveTzs(customer: Found): string | null {
  return customer.accounts.find((a) => a.status === 'active' && a.currency === 'TZS')?.number ?? null;
}

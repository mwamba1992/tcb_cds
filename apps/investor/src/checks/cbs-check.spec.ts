import type { CbsCustomerView } from '../clients/clients';
import { checkAgainstCbs } from './cbs-check';

const ASHA: CbsCustomerView = {
  found: true,
  customerId: 'CIF-1',
  fullName: 'ASHA JUMA MUSSA',
  dateOfBirth: '1990-05-21',
  nidaNumber: '19900521131050000137',
  accounts: [
    { number: '0250311875202', currency: 'USD', status: 'active' },
    { number: '0150311875201', currency: 'TZS', status: 'active' },
  ],
};
const identity = { fullName: 'ASHA JUMA MUSSA', dateOfBirth: '1990-05-21' };

describe('checkAgainstCbs', () => {
  it('links an existing customer to their active TZS account', () => {
    const result = checkAgainstCbs({
      nidaNumber: '19900521131050000137',
      identity,
      declaredAccount: null,
      byNida: ASHA,
      byAccount: null,
    });
    expect(result.outcome).toBe('clear');
    expect(result.link).toEqual({ kind: 'existing', customerId: 'CIF-1', account: '0150311875201' });
  });

  it('treats someone Core Banking does not know as new to bank, not as a problem', () => {
    const result = checkAgainstCbs({
      nidaNumber: '19950101120010000999',
      identity,
      declaredAccount: null,
      byNida: { found: false },
      byAccount: null,
    });
    expect(result).toMatchObject({ outcome: 'clear', link: { kind: 'new_to_bank' } });
  });

  it('refuses to link an account that belongs to someone else', () => {
    const result = checkAgainstCbs({
      nidaNumber: '19950101120010000999',
      identity,
      declaredAccount: '0150311875201',
      byNida: { found: false },
      byAccount: ASHA,
    });
    expect(result.outcome).toBe('review');
    expect(result.reasons).toEqual(['Declared TCB account belongs to a different customer']);
    expect(result.link.kind).toBe('unresolved');
  });

  it('asks for review when Core Banking holds the name differently', () => {
    const result = checkAgainstCbs({
      nidaNumber: '19900521131050000137',
      identity: { ...identity, fullName: 'ASHA JUMA MUSSA KWEKA' },
      declaredAccount: null,
      byNida: ASHA,
      byAccount: null,
    });
    expect(result.reasons).toEqual(['Name on NIDA does not match the Core Banking customer record']);
  });
});

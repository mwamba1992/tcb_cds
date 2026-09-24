/**
 * The Core Banking operations GovSec needs, in the platform's vocabulary.
 *
 * TCB has not yet provided its Core Banking API specification, so the only
 * implementation is a stub with fixed customers. When the specification arrives, a
 * live adapter implements this interface and nothing outside cbs-gateway changes.
 */

export interface CbsAccount {
  number: string;
  currency: 'TZS' | 'USD';
  /** active | dormant | closed */
  status: string;
}

export interface CbsCustomer {
  customerId: string;
  /** As Core Banking holds it, upper case. */
  fullName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  nidaNumber: string;
  accounts: CbsAccount[];
}

export interface CoreBanking {
  findCustomerByNida(nidaNumber: string): Promise<CbsCustomer | null>;
  findCustomerByAccount(accountNumber: string): Promise<CbsCustomer | null>;
  /** Ledger balance of a TZS account, in minor units; null when the account is unknown. */
  ledgerBalance(accountNumber: string): Promise<bigint | null>;
  /** Hands an account-opening request to Core Banking; returns its own reference. */
  submitAccountOpening(request: {
    reference: string;
    nidaNumber: string;
    fullName: string;
    dateOfBirth: string;
  }): Promise<void>;
}

export const CORE_BANKING = 'CORE_BANKING';

/** Core Banking could not be reached or answered with an error. */
export class CoreBankingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreBankingUnavailableError';
  }
}

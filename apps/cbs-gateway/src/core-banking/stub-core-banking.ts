import { Logger } from '@nestjs/common';
import type { CbsCustomer, CoreBanking } from './core-banking';

/**
 * Core Banking stand-in for development and demos. Every person below is fictitious.
 *
 * The fixtures cover the cases the onboarding flow has to handle:
 *  - Asha: an existing customer whose record matches exactly (auto-approval path).
 *  - Juma: an existing customer whose name is held abbreviated (review path).
 *  - Grace: an existing customer (screening flags her separately).
 *  - Anyone else: new to bank, so an account-opening request is raised.
 */
const CUSTOMERS: readonly CbsCustomer[] = [
  {
    customerId: 'CIF-0098213',
    fullName: 'ASHA JUMA MUSSA',
    dateOfBirth: '1990-05-21',
    nidaNumber: '19900521131050000137',
    accounts: [{ number: '0150311875201', currency: 'TZS', status: 'active' }],
  },
  {
    customerId: 'CIF-0071452',
    fullName: 'JUMA H. MWINYI',
    dateOfBirth: '1986-03-14',
    nidaNumber: '19860314112030000124',
    accounts: [{ number: '0150286411001', currency: 'TZS', status: 'active' }],
  },
  {
    customerId: 'CIF-0064408',
    fullName: 'GRACE ANNA NDEGE',
    dateOfBirth: '1979-11-02',
    nidaNumber: '19791102141170000211',
    accounts: [
      { number: '0150199024301', currency: 'TZS', status: 'active' },
      { number: '0250199024302', currency: 'USD', status: 'active' },
    ],
  },
];

export class StubCoreBanking implements CoreBanking {
  private readonly logger = new Logger('StubCoreBanking');

  async findCustomerByNida(nidaNumber: string): Promise<CbsCustomer | null> {
    return CUSTOMERS.find((c) => c.nidaNumber === nidaNumber) ?? null;
  }

  async findCustomerByAccount(accountNumber: string): Promise<CbsCustomer | null> {
    return CUSTOMERS.find((c) => c.accounts.some((a) => a.number === accountNumber)) ?? null;
  }

  async submitAccountOpening(request: { reference: string }): Promise<void> {
    this.logger.log(`Stub: account opening ${request.reference} accepted by "Core Banking"`);
  }
}

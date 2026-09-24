import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type InvestorConfig } from '../config/configuration';
import { InternalHttp } from './internal-http';

export interface Contact {
  accountId: string;
  phoneNumber: string;
  locale: 'sw' | 'en';
}

export type CbsCustomerView =
  | { found: false }
  | {
      found: true;
      customerId: string;
      fullName: string;
      dateOfBirth: string;
      nidaNumber: string;
      accounts: { number: string; currency: string; status: string }[];
    };

@Injectable()
export class IdentityClient {
  private readonly http: InternalHttp;

  constructor(@Inject(CONFIG) config: InvestorConfig) {
    this.http = new InternalHttp('identity', config.services.identityUrl, config.internalSecret);
  }

  /** The account behind a phone number, or null. */
  async accountByPhone(phoneNumber: string): Promise<string | null> {
    const found = await this.http.post<{ accountId: string | null }>('/internal/v1/accounts/by-phone', { phoneNumber });
    return found.accountId;
  }

  contact(accountId: string): Promise<Contact> {
    return this.http.get<Contact>(`/internal/v1/accounts/${encodeURIComponent(accountId)}/contact`);
  }
}

@Injectable()
export class CbsClient {
  private readonly http: InternalHttp;

  constructor(@Inject(CONFIG) config: InvestorConfig) {
    this.http = new InternalHttp('cbs-gateway', config.services.cbsGatewayUrl, config.internalSecret);
  }

  customerByNida(nidaNumber: string): Promise<CbsCustomerView> {
    return this.http.post('/internal/v1/customers/lookup', { nidaNumber });
  }

  customerByAccount(accountNumber: string): Promise<CbsCustomerView> {
    return this.http.post('/internal/v1/accounts/lookup', { accountNumber });
  }

  requestAccountOpening(input: {
    investorId: string;
    nidaNumber: string;
    fullName: string;
    dateOfBirth: string;
  }): Promise<{ reference: string; status: string }> {
    return this.http.post('/internal/v1/account-openings', input);
  }
}

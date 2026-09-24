import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AuctionConfig } from '../config/configuration';
import { InternalHttp } from './internal-http';

export interface Eligibility {
  investorId: string;
  reference: string;
  name: string | null;
  firstName: string | null;
  canBid: boolean;
  status: string;
  cdsAccount: string | null;
  bankAccount: string | null;
}

export interface Balance {
  accountNumber: string;
  ledger: string;
  onHold: string;
  available: string;
}

export interface OutgoingPackage {
  isin: string;
  bids: { securityAccount: string; faceValue: string; competitive: boolean; price: string | null }[];
}

@Injectable()
export class Neighbours {
  readonly investor: InternalHttp;
  readonly cbs: InternalHttp;
  readonly identity: InternalHttp;
  readonly botGateway: InternalHttp;

  constructor(@Inject(CONFIG) config: AuctionConfig) {
    const s = config.services;
    this.investor = new InternalHttp('investor', s.investorUrl, config.internalSecret);
    this.cbs = new InternalHttp('cbs-gateway', s.cbsGatewayUrl, config.internalSecret);
    this.identity = new InternalHttp('identity', s.identityUrl, config.internalSecret);
    this.botGateway = new InternalHttp('bot-gateway', s.botGatewayUrl, config.internalSecret, 60_000);
  }

  eligibility(accountId: string): Promise<Eligibility> {
    return this.investor.get(`/internal/v1/investors/by-account/${accountId}`);
  }

  balance(accountNumber: string): Promise<Balance> {
    return this.cbs.get(`/internal/v1/accounts/${accountNumber}/balance`);
  }

  placeHold(reference: string, accountNumber: string, amount: string) {
    return this.cbs.post<{ status: string }>('/internal/v1/holds', { reference, accountNumber, amount });
  }

  adjustHold(reference: string, amount: string) {
    return this.cbs.put<{ status: string }>(`/internal/v1/holds/${reference}`, { amount });
  }

  releaseHold(reference: string) {
    return this.cbs.post<{ status: string }>(`/internal/v1/holds/${reference}/release`);
  }

  /** Spend a PIN approval, as the action it authorised commits. */
  redeemStepUp(input: { grantId: string; accountId: string; scope: string; amountMinor?: bigint }) {
    return this.identity.post<void>('/internal/v1/step-up/redeem', {
      grantId: input.grantId,
      accountId: input.accountId,
      scope: input.scope,
      ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor.toString() } : {}),
    });
  }

  submitBatch(reference: string, packages: OutgoingPackage[]) {
    return this.botGateway.post<{ batchReference: string; bidsSubmitted: number; replayed: boolean }>(
      `/internal/v1/batches/${reference}`,
      { packages },
    );
  }
}

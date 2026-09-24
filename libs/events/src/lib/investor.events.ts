/**
 * Events the investor service publishes on the `govsec.investor` exchange.
 *
 * Identified by investor id and identity account id only: no names, NIDA numbers or
 * phone numbers, since every consumer of the exchange sees every field.
 */

export const INVESTOR_EVENTS = {
  onboardingSubmitted: 'investor.onboarding.submitted',
  /** Checks were not all clear; a KYC case awaits the back office. */
  kycCaseOpened: 'investor.kyc.case_opened',
  kycInfoRequested: 'investor.kyc.info_requested',
  kycApproved: 'investor.kyc.approved',
  kycRejected: 'investor.kyc.rejected',
  /** The investor's TCB account (existing or newly opened) is linked. */
  bankAccountLinked: 'investor.bank_account.linked',
  cdsRequested: 'investor.cds.requested',
  /** The investor can now bid: KYC approved, CDS account recorded. */
  cdsOpened: 'investor.cds.opened',
} as const;

export type InvestorEventType = (typeof INVESTOR_EVENTS)[keyof typeof INVESTOR_EVENTS];

export interface InvestorEventPayload {
  investorId: string;
  accountId: string;
  at: string;
}

export interface KycDecisionPayload extends InvestorEventPayload {
  risk: 'low' | 'medium' | 'high';
  /** `auto` when every check was clear and the risk low. */
  decidedBy: 'auto' | 'staff';
}

export interface CdsOpenedPayload extends InvestorEventPayload {
  cdsAccount: string;
}

/** No account number: a consumer that needs it asks the investor service. */
export interface BankAccountLinkedPayload extends InvestorEventPayload {
  bankStatus: 'existing' | 'opened';
}

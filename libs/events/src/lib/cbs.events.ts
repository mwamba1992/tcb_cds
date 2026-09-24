/**
 * Events cbs-gateway publishes on the `govsec.cbs` exchange. Payloads use the
 * platform's vocabulary; no consumer parses a Core Banking message.
 */

export const CBS_EVENTS = {
  /** A TCB account requested for a new-to-bank investor has been opened. */
  accountOpened: 'cbs.account.opened',
} as const;

export type CbsEventType = (typeof CBS_EVENTS)[keyof typeof CBS_EVENTS];

export interface CbsAccountOpenedPayload {
  /** AP-… */
  reference: string;
  investorId: string;
  customerId: string;
  accountNumber: string;
  openedAt: string;
}

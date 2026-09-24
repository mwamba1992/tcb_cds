/**
 * Events bot-gateway publishes on the `govsec.bot` exchange (TAD §7.3, §7.5).
 *
 * They are the only way the rest of the platform learns what the Bank of Tanzania
 * said. Payloads use the platform's vocabulary: money as decimal strings, booleans not
 * 'Y'/'N', our own status names. No consumer ever parses a BoT payload.
 *
 * Bids are identified by BoT's `requestId` and the `batchReference` we submitted them
 * under. The auction service maps these to its own bid ids; BoT's /winners cannot be
 * used for that because it carries no account or requestId (TAD Appendix B, B1).
 */

export const BOT_EVENTS = {
  auctionPublished: 'bot.auction.published',
  auctionUpdated: 'bot.auction.updated',
  batchSubmitted: 'bot.batch.submitted',
  /** BoT was checked for every bid in a batch; carries BoT's requestId for each. */
  batchReconciled: 'bot.batch.reconciled',
  /** Callback allotment totals compared with BoT's /winners totals for an ISIN. */
  winnersChecked: 'bot.winners.checked',
  bidAccepted: 'bot.bid.accepted',
  bidRejected: 'bot.bid.rejected',
  bidAllotted: 'bot.bid.allotted',
  bidUnsuccessful: 'bot.bid.unsuccessful',
  /** A callback whose status the platform does not recognise; kept for investigation. */
  callbackUnrecognised: 'bot.callback.unrecognised',
} as const;

export type BotEventType = (typeof BOT_EVENTS)[keyof typeof BOT_EVENTS];

export interface BotAuctionPayload {
  isin: string;
  name: string;
  instrument: 'bill' | 'bond';
  auctionDate: string | null;
  maturityDate: string | null;
  competitiveOffer: string;
  nonCompetitiveOffer: string;
  status: 'open' | 'closed' | 'unknown';
}

export interface BotBatchSubmittedPayload {
  batchReference: string;
  bidsSubmitted: number;
  totalFaceValue: string;
  /** True when BoT already had this reference: the earlier attempt reached it. */
  alreadySubmitted: boolean;
  requestedBy: string;
}

export interface BotBidOutcomePayload {
  requestId: string | null;
  batchReference: string | null;
  isin: string | null;
  /** BoT's status word, kept for audit, e.g. "allotted". */
  botStatus: string | null;
  /** For allotments: face value allotted, decimal string. */
  allottedFaceValue: string | null;
  /** For allotments: price per 100, decimal string. */
  allottedPrice: string | null;
  message: string | null;
  receivedAt: string;
}

export interface ReconciledBid {
  isin: string;
  securityAccount: string;
  faceValue: string;
  competitive: boolean;
  price: string | null;
  /** BoT's id for this bid; how callbacks are matched to it. */
  requestId: string;
  botStatus: string;
}

export interface BotBatchReconciledPayload {
  batchReference: string;
  /** matched: BoT holds exactly what we sent. breaks: see missing, unexpected, rejected. */
  status: 'matched' | 'breaks';
  bids: ReconciledBid[];
  /** Sent by us, not found at BoT. */
  missing: { isin: string; securityAccount: string; faceValue: string }[];
  /** Held by BoT under this batch reference, not sent by us. */
  unexpected: {
    isin: string;
    requestId: string;
    securityAccount: string | null;
    faceValue: string;
  }[];
  /** Found at BoT, but BoT rejected them. */
  rejected: ReconciledBid[];
}

export interface BotWinnersCheckedPayload {
  isin: string;
  status: 'matched' | 'break';
  /** Sum of face value allotted to TCB's bids, from BoT's callbacks. */
  callbacksTotal: string;
  /** Sum of face value BoT lists for TCB on /winners. */
  winnersTotal: string;
}

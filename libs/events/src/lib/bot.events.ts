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

/**
 * Events the auction service publishes on `govsec.auction`. Ids and amounts only:
 * no names, CDS accounts or phone numbers.
 */

export const AUCTION_EVENTS = {
  bidPlaced: 'auction.bid.placed',
  bidAmended: 'auction.bid.amended',
  bidWithdrawn: 'auction.bid.withdrawn',
  /** BoT's outcome for a bid: accepted, rejected, allotted, partially_allotted, unsuccessful. */
  bidResult: 'auction.bid.result',
  batchPrepared: 'auction.batch.prepared',
  batchApproved: 'auction.batch.approved',
  batchSubmitted: 'auction.batch.submitted',
} as const;

export type AuctionEventType = (typeof AUCTION_EVENTS)[keyof typeof AUCTION_EVENTS];

export interface BidEventPayload {
  bidReference: string;
  investorId: string;
  accountId: string;
  isin: string;
  /** Whole TZS, decimal string. */
  faceValue: string;
  competitive: boolean;
  price: string | null;
  /** TZS held on the investor's account, decimal string. */
  held: string;
  at: string;
}

export interface BidResultPayload extends BidEventPayload {
  result: 'accepted' | 'rejected' | 'allotted' | 'partially_allotted' | 'unsuccessful';
  allottedFaceValue: string | null;
  allottedPrice: string | null;
}

export interface BatchEventPayload {
  batchId: string;
  batchReference: string;
  isin: string;
  bids: number;
  totalFaceValue: string;
  at: string;
}

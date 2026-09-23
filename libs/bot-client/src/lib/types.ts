/**
 * Wire shapes of the BoT GSS Bidding API, exactly as BOT-SPEC-GSS-2026-v1.0 §9 defines
 * them.
 *
 * These types describe what crosses the wire and nothing more. Amounts are JSON
 * numbers here because that is what BoT sends; they are converted to Money in
 * ./amounts.ts before anything outside bot-gateway sees them. No other service should
 * import these types — they are the anti-corruption boundary (TAD §7.3).
 *
 * Where the specification is ambiguous the type is deliberately loose and the open
 * question is referenced by its TAD Appendix B number.
 */

export type BotInstrumentType = 'TBONDS' | 'TBILLS';
export type BotAuctionStatus = 'OPEN' | 'CLOSED';
export type BotCompetitiveFlag = 'Y' | 'N';
/** Documented bid statuses. B6: callbacks also send values outside this set. */
export type BotBidAction = 'initiated' | 'processing' | 'accepted' | 'rejected';

export interface BotAuthRequest {
  username: string;
}

export interface BotAuthResponse {
  status?: string;
  mode: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  tokenType?: string;
  issuedAt?: string;
}

/** Schema AuctionItem. B4: no cut-off time, minimum bid or coupon rate yet. */
export interface BotAuctionItem {
  ISIN?: string;
  securityName?: string;
  instrumentType?: BotInstrumentType;
  auctionDate?: string;
  maturityDate?: string;
  tenderedSizeCompetitive?: number;
  tenderedSizeNonCompetitive?: number;
  status?: BotAuctionStatus;
}

export interface BotAuctionQuery {
  ISIN?: string;
  instrumentType?: BotInstrumentType;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
  sortBy?: 'auctionDate' | 'instrumentType';
  sortOrder?: 'asc' | 'desc';
}

/** Schema Model3: one investor's bid inside a package. */
export interface BotBid {
  /** The investor's CDS / CSD security account. */
  securityAccount: string;
  /** Whole shillings. */
  amount: number;
  competitive: BotCompetitiveFlag;
  /** Price per 100 face value, as a decimal string. B5: required even when N. */
  price: string;
}

/** Schema Bid: the bids for one ISIN. POST /bids/{batchReference} takes an array. */
export interface BotBidPackage {
  ISIN: string;
  bids: BotBid[];
}

/** Response to POST /bids/{batchReference}. B2: batch-level only, no per-bid ids. */
export interface BotSubmitBidsResponse {
  status?: string;
  batchReference?: string;
  submittedBidsCount?: number;
  totalAmount?: number;
  message?: string;
  timestamp?: string;
  data?: {
    requestId?: string;
    totalBids?: number;
    receivedAt?: string;
    message?: string;
  };
}

/** Schema BidResponse: one bid as BoT holds it. */
export interface BotBidRecord {
  ISIN?: string;
  investor: string;
  securityAccount?: string;
  amount: number;
  price: number;
  competitive: BotCompetitiveFlag;
  action: BotBidAction | string;
  remarks?: string;
  requestId: string;
  batchReference: string;
  receivedAt?: string;
  createdAt?: string;
}

export interface BotBidQuery {
  requestId?: string;
  batchReference?: string;
  securityAccount?: string;
  action?: string;
  competitive?: BotCompetitiveFlag;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Schema Model8: PUT /bids/{ISIN}/{reference}. */
export interface BotUpdateBid {
  amount?: number;
  competitive?: BotCompetitiveFlag;
  price: string;
}

/** Schema WinnerResponse. B1: no securityAccount or requestId. */
export interface BotWinner {
  investor?: string;
  amount?: number;
  price?: number;
  competitive?: BotCompetitiveFlag;
}

/** Schema Model1: winners for one ISIN. */
export interface BotWinnersForIsin {
  ISIN?: string;
  securityName?: string;
  auctionDate?: string;
  winners: BotWinner[];
  hasMore?: boolean;
  total?: number;
}

/** Schema CallbackPayload. B6: `data` is untyped in the specification. */
export interface BotCallbackPayload {
  data: Record<string, unknown>;
  message: string;
}

/** Standard error body (spec §10). */
export interface BotErrorBody {
  status: 'error';
  code: string;
  message: string;
  timestamp?: string;
  path?: string;
}

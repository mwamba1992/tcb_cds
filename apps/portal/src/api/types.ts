import type { Permission, Role } from '@govsec/auth/roles';
import type { BidRules, Instrument } from '../lib/bid-math';

/**
 * The contract between the portal and the platform.
 *
 * Every screen talks to `PortalApi` and nothing else. Today it is backed by
 * `MockPortalApi`; when the services expose these endpoints an HTTP implementation
 * replaces it without a screen changing. Money is always a decimal string and every
 * timestamp is ISO 8601 UTC, as on the wire.
 */

// ---------------------------------------------------------------- session

export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  /** Shown under the name in the sidebar, e.g. "Operations · Checker". */
  roleLabel: string;
  role: Role;
  permissions: readonly Permission[];
}

// ---------------------------------------------------------------- investor

export type AuctionStatus = 'Open' | 'Upcoming' | 'Closed';

export interface Auction {
  id: string;
  isin: string;
  name: string;
  instrument: Instrument;
  auctionDate: string;
  cutoffAt: string;
  /** For an upcoming auction: when bidding opens. */
  opensAt?: string;
  offerSize: string;
  rules: BidRules;
  status: AuctionStatus;
  /** A sensible starting price for the bid form; not a recommendation. */
  indicativePrice: string;
}

export interface Holding {
  isin: string;
  name: string;
  kind: 'bill' | 'bond';
  faceValue: string;
  /** Yield at purchase, percent with two decimals. */
  yield: string;
  maturityDate: string;
}

export interface Cashflow {
  kind: 'Coupon' | 'Redemption';
  security: string;
  /** Net of withholding tax for coupons. */
  amount: string;
  date: string;
}

export interface SettlementAccount {
  label: string;
  masked: string;
}

export interface InvestorSummary {
  firstName: string;
  cdsAccount: string;
  settlementAccount: SettlementAccount;
  availableBalance: string;
  fundsOnHold: string;
  openBidCount: number;
  /** Percent with two decimals, weighted by face value. */
  weightedYield: string;
  /** Withholding tax rate on coupons, percent; shown under the payments list. */
  couponTaxRate: string;
}

export type BidType = 'Competitive' | 'Non-competitive';

export type BidStatus =
  | 'Pending submission'
  | 'Submitted'
  | 'Allotted'
  | 'Partially allotted'
  | 'Unsuccessful'
  | 'Withdrawn';

export interface Bid {
  reference: string;
  auctionId: string;
  security: string;
  auctionDate: string;
  cutoffAt: string;
  type: BidType;
  faceValue: string;
  /** Null for a non-competitive bid, which takes the weighted average price. */
  price: string | null;
  /** Null until results are known. */
  allotted: string | null;
  heldAmount: string;
  status: BidStatus;
}

export interface PlaceBidRequest {
  auctionId: string;
  type: BidType;
  faceValue: string;
  price: string | null;
  /** Step-up PIN (TAD §10.1). Sent once, never stored. */
  pin: string;
}

// ---------------------------------------------------------------- operations

export type KycStatus =
  | 'New'
  | 'Info requested'
  | 'Awaiting checker'
  | 'Returned'
  | 'Approved'
  | 'Rejected';

export type Risk = 'Low' | 'Medium' | 'High';

export interface KycField {
  label: string;
  a: string;
  b: string;
  result: 'match' | 'mismatch' | 'n/a';
}

export interface KycScreening {
  label: string;
  result: string;
  ok: boolean;
}

export interface KycCase {
  id: string;
  name: string;
  type: string;
  channel: string;
  reason: string;
  risk: Risk;
  openedAt: string;
  slaHours: number;
  sourceA: string;
  sourceB: string;
  fields: KycField[];
  screening: KycScreening[];
  status: KycStatus;
  /** Who took the maker decision, so a checker can be refused if it was them. */
  makerId: string | null;
  /** Live data only: the decisions as recorded, for the trail under the case. */
  makerName?: string | null;
  makerNote?: string | null;
  checkerName?: string | null;
  checkerNote?: string | null;
  /** Live data only: every reason the checks gave, not just the headline. */
  reasons?: string[];
}

export type KycAction = 'approve' | 'request-info' | 'reject' | 'final-approve' | 'return';

export type BatchStage =
  | 'Awaiting consolidation'
  | 'Awaiting maker'
  | 'Awaiting checker'
  | 'Submitting'
  | 'Acknowledged by BoT';

export interface Actor {
  id: string;
  name: string;
  at: string;
}

export interface Batch {
  id: string;
  auctionId: string;
  name: string;
  isin: string;
  cutoffAt: string;
  bids: number;
  competitive: number;
  nonCompetitive: number;
  faceValue: string;
  fundsHeld: string;
  stage: BatchStage;
  consolidatedAt: string;
  preparedBy: Actor | null;
  approvedBy: Actor | null;
  /** The BoT batch reference used on POST /bids (TAD §7.3). */
  batchReference: string | null;
  acknowledgedAt: string | null;
}

export interface AuctionControlRow {
  auctionId: string;
  name: string;
  isin: string;
  cutoffAt: string;
  bids: number;
  faceValue: string;
  stage: BatchStage | 'Collecting bids';
}

export interface OpsOverview {
  bidsOpen: number;
  bidsSinceOpen: number;
  faceValueBid: string;
  submissionWindowClosesAt: string;
  channels: { channel: string; bids: number }[];
  control: AuctionControlRow[];
}

export type ReconResult = 'Matched' | 'Break' | 'Resolved';

export interface ReconRow {
  id: string;
  investor: string;
  cdsAccount: string;
  allocation: string;
  cbsDebit: string | null;
  cdsCredit: string | null;
  result: ReconResult;
  /** Which leg disagrees. */
  breakSide: 'cbs' | 'cds' | null;
  detail: string;
  /** The remedy offered for a break. */
  action: string | null;
  resolvedBy: Actor | null;
}

export interface ReconRun {
  auctionName: string;
  auctionDate: string;
  valueDate: string;
  records: number;
  matched: number;
  rows: ReconRow[];
}

// ---------------------------------------------------------------- errors

export type ApiErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'BID_CUTOFF_PASSED'
  | 'INVALID_BID'
  | 'INVALID_PIN'
  | 'NOT_WITHDRAWABLE'
  | 'MAKER_CHECKER'
  | 'FORBIDDEN'
  | 'INVALID_STATE'
  | 'NOT_FOUND';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------- the port

export interface PortalApi {
  // investor
  investorSummary(): Promise<InvestorSummary>;
  auctions(): Promise<Auction[]>;
  holdings(): Promise<Holding[]>;
  cashflows(): Promise<Cashflow[]>;
  myBids(): Promise<Bid[]>;
  placeBid(request: PlaceBidRequest): Promise<Bid>;
  withdrawBid(reference: string): Promise<Bid>;

  // operations
  opsOverview(): Promise<OpsOverview>;
  kycCases(): Promise<KycCase[]>;
  actOnKyc(caseId: string, action: KycAction, actor: SessionUser): Promise<KycCase>;
  batches(): Promise<Batch[]>;
  prepareBatch(batchId: string, actor: SessionUser): Promise<Batch>;
  approveBatch(batchId: string, actor: SessionUser): Promise<Batch>;
  reconciliation(): Promise<ReconRun>;
  resolveBreak(rowId: string, actor: SessionUser): Promise<ReconRow>;
}

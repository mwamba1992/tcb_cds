import { PERMISSIONS, type Permission } from '@govsec/auth/roles';
import { generateReference } from '@govsec/reference';
import Big from 'big.js';
import { amountProblem, fundsHold, isValidPrice } from '../../lib/bid-math';
import { subtract, sum } from '../../lib/money';
import {
  ApiError,
  type Auction,
  type Batch,
  type Bid,
  type KycAction,
  type KycCase,
  type OpsOverview,
  type PlaceBidRequest,
  type PortalApi,
  type ReconRow,
  type SessionUser,
} from '../types';
import {
  CASHFLOWS,
  HOLDINGS,
  seedAuctions,
  seedBatches,
  seedBids,
  seedClock,
  seedKyc,
  seedRecon,
  type SeedClock,
} from './data';

export interface MockOptions {
  /** Starting balance on the settlement account; the design's two scenarios. */
  availableBalance?: string;
  /** Simulated network latency, so loading states are exercised. */
  latencyMs?: number;
  /** Delay before BoT "acknowledges" a submitted batch. */
  botAckMs?: number;
  /** Override the clock (tests). */
  clock?: SeedClock;
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * An in-memory stand-in for the platform, enforcing the same rules the services will:
 * funds are held before a bid is accepted, a bid can be withdrawn only before its
 * batch is submitted, and the checker must be a different person from the maker.
 *
 * It exists so the portal can be built, demonstrated and tested before the backend
 * endpoints do. Nothing in a screen may depend on it being a mock.
 */
export class MockPortalApi implements PortalApi {
  private readonly clock: SeedClock;
  private readonly latency: number;
  private readonly botAckMs: number;
  private available: string;
  private auctionList: Auction[];
  private bids: Bid[];
  private kyc: KycCase[];
  private batchList: Batch[];
  private recon: ReconRow[];

  constructor(options: MockOptions = {}) {
    this.clock = options.clock ?? seedClock();
    this.latency = options.latencyMs ?? 180;
    this.botAckMs = options.botAckMs ?? 1600;
    this.available = options.availableBalance ?? '26340000.00';
    this.auctionList = seedAuctions(this.clock);
    this.bids = seedBids(this.clock);
    this.kyc = seedKyc(this.clock);
    this.batchList = seedBatches(this.clock);
    this.recon = seedRecon();
  }

  private async respond<T>(value: T): Promise<T> {
    if (this.latency > 0) await new Promise((resolve) => setTimeout(resolve, this.latency));
    return clone(value);
  }

  private now(): Date {
    return new Date();
  }

  private requirePermission(actor: SessionUser, permission: Permission): void {
    if (!actor.permissions.includes(permission)) {
      throw new ApiError('FORBIDDEN', `Your role cannot perform this action (${permission}).`);
    }
  }

  // ------------------------------------------------------------------ investor

  async investorSummary() {
    const open = this.bids.filter(
      (b) => b.status === 'Pending submission' || b.status === 'Submitted',
    );
    const face = sum(HOLDINGS.map((h) => h.faceValue));
    const weighted = HOLDINGS.reduce(
      (total, h) => total.plus(new Big(h.faceValue).times(h.yield)),
      new Big(0),
    );
    return this.respond({
      firstName: 'Amina',
      cdsAccount: 'CDS-TCB-0048213',
      settlementAccount: { label: 'TCB Current', masked: '0152•••4471' },
      availableBalance: this.available,
      fundsOnHold: sum(open.map((b) => b.heldAmount)),
      openBidCount: open.length,
      weightedYield: weighted.div(face).round(2, Big.roundHalfUp).toFixed(2),
      couponTaxRate: '10',
    });
  }

  async auctions() {
    return this.respond(this.auctionList);
  }

  async holdings() {
    return this.respond(HOLDINGS);
  }

  async cashflows() {
    return this.respond(CASHFLOWS);
  }

  async myBids() {
    return this.respond(this.bids);
  }

  async placeBid(request: PlaceBidRequest) {
    const auction = this.auctionList.find((a) => a.id === request.auctionId);
    if (!auction || auction.status !== 'Open') {
      throw new ApiError('NOT_FOUND', 'This auction is not open for bids.');
    }
    if (new Date(auction.cutoffAt) <= this.now()) {
      throw new ApiError('BID_CUTOFF_PASSED', 'Bids for this auction have closed.');
    }
    if (!/^\d{4}$/.test(request.pin)) {
      throw new ApiError('INVALID_PIN', 'Enter your 4-digit transaction PIN.');
    }
    if (amountProblem(request.faceValue, auction.rules) !== null) {
      throw new ApiError('INVALID_BID', 'The amount does not meet the auction rules.');
    }
    const competitive = request.type === 'Competitive';
    if (competitive && (request.price === null || !isValidPrice(request.price))) {
      throw new ApiError('INVALID_BID', 'Enter a price per 100 between 0 and 110.');
    }
    // The server computes the hold. The portal's preview is never trusted for this.
    const hold = fundsHold(request.faceValue, auction.rules);
    if (new Big(hold).gt(this.available)) {
      throw new ApiError(
        'INSUFFICIENT_FUNDS',
        'Insufficient funds. The platform holds the full amount before accepting a bid.',
      );
    }
    this.available = subtract(this.available, hold);
    const bid: Bid = {
      reference: generateReference('bid'),
      auctionId: auction.id,
      security: auction.name,
      auctionDate: auction.auctionDate,
      cutoffAt: auction.cutoffAt,
      type: request.type,
      faceValue: request.faceValue,
      price: competitive ? new Big(request.price ?? '0').toFixed(2) : null,
      allotted: null,
      heldAmount: hold,
      status: 'Pending submission',
    };
    this.bids = [bid, ...this.bids];
    return this.respond(bid);
  }

  async withdrawBid(reference: string) {
    const bid = this.bids.find((b) => b.reference === reference);
    if (!bid) throw new ApiError('NOT_FOUND', 'Bid not found.');
    if (bid.status !== 'Pending submission') {
      // Once a batch is with BoT there is no cancel endpoint (TAD Appendix B, B3).
      throw new ApiError('NOT_WITHDRAWABLE', 'This bid has already been submitted to BoT.');
    }
    bid.status = 'Withdrawn';
    this.available = sum([this.available, bid.heldAmount]);
    bid.heldAmount = '0.00';
    return this.respond(bid);
  }

  // ---------------------------------------------------------------- operations

  async opsOverview(): Promise<OpsOverview> {
    const stageOf = (auctionId: string) =>
      this.batchList.find((b) => b.auctionId === auctionId)?.stage;
    const bond = this.auctionList.find((a) => a.id === 'A3');
    const control = this.batchList.map((b) => ({
      auctionId: b.auctionId,
      name: b.name,
      isin: b.isin,
      cutoffAt: b.cutoffAt,
      bids: b.bids,
      faceValue: b.faceValue,
      stage: stageOf(b.auctionId) ?? ('Collecting bids' as const),
    }));
    if (bond) {
      control.push({
        auctionId: bond.id,
        name: bond.name,
        isin: bond.isin,
        cutoffAt: bond.cutoffAt,
        bids: 86,
        faceValue: '6450000000',
        stage: 'Collecting bids',
      });
    }
    const cutoff = new Date(this.clock.cutoff);
    return this.respond({
      bidsOpen: 1284,
      bidsSinceOpen: 212,
      faceValueBid: sum(control.map((c) => c.faceValue)),
      submissionWindowClosesAt: new Date(cutoff.getTime() - 15 * 60_000).toISOString(),
      channels: [
        { channel: 'Mobile app', bids: 591 },
        { channel: 'USSD', bids: 308 },
        { channel: 'Web portal', bids: 282 },
        { channel: 'Chatbot', bids: 103 },
      ],
      control,
    });
  }

  async kycCases() {
    return this.respond(this.kyc);
  }

  async actOnKyc(caseId: string, action: KycAction, actor: SessionUser) {
    const kase = this.kyc.find((k) => k.id === caseId);
    if (!kase) throw new ApiError('NOT_FOUND', 'Case not found.');
    const makerStates = ['New', 'Returned', 'Info requested'];

    if (action === 'approve' || action === 'request-info' || action === 'reject') {
      this.requirePermission(actor, PERMISSIONS.kycReview);
      if (!makerStates.includes(kase.status)) {
        throw new ApiError('INVALID_STATE', 'This case is not waiting for a maker decision.');
      }
      kase.makerId = actor.id;
      kase.status =
        action === 'approve'
          ? 'Awaiting checker'
          : action === 'reject'
            ? 'Rejected'
            : 'Info requested';
    } else {
      this.requirePermission(actor, PERMISSIONS.kycDecide);
      if (kase.status !== 'Awaiting checker') {
        throw new ApiError('INVALID_STATE', 'This case is not waiting for a checker.');
      }
      if (kase.makerId === actor.id) {
        throw new ApiError('MAKER_CHECKER', 'A different user must approve a decision you made.');
      }
      kase.status = action === 'final-approve' ? 'Approved' : 'Returned';
    }
    return this.respond(kase);
  }

  async batches() {
    return this.respond(this.batchList);
  }

  async prepareBatch(batchId: string, actor: SessionUser) {
    this.requirePermission(actor, PERMISSIONS.batchPrepare);
    const batch = this.batchList.find((b) => b.id === batchId);
    if (!batch) throw new ApiError('NOT_FOUND', 'Batch not found.');
    if (batch.stage !== 'Awaiting maker') {
      throw new ApiError('INVALID_STATE', 'This batch is not waiting for a maker.');
    }
    batch.preparedBy = { id: actor.id, name: shortName(actor.name), at: this.now().toISOString() };
    batch.stage = 'Awaiting checker';
    return this.respond(batch);
  }

  async approveBatch(batchId: string, actor: SessionUser) {
    this.requirePermission(actor, PERMISSIONS.batchApprove);
    const batch = this.batchList.find((b) => b.id === batchId);
    if (!batch) throw new ApiError('NOT_FOUND', 'Batch not found.');
    if (batch.stage !== 'Awaiting checker') {
      throw new ApiError('INVALID_STATE', 'This batch is not waiting for a checker.');
    }
    if (batch.preparedBy?.id === actor.id) {
      throw new ApiError('MAKER_CHECKER', 'A different user must approve a batch you prepared.');
    }
    batch.approvedBy = { id: actor.id, name: shortName(actor.name), at: this.now().toISOString() };
    batch.stage = 'Submitting';
    // BoT's batch reference: 8-character participant code, YYMMDD, sequence
    // (@govsec/bot-client). The code here is a placeholder until BoT assigns TCB's.
    const yymmdd = batch.cutoffAt.slice(2, 10).replace(/-/g, '');
    batch.batchReference = `TCBGSP01-${yymmdd}-${batch.id === 'B1' ? '001' : '002'}`;
    setTimeout(() => {
      batch.stage = 'Acknowledged by BoT';
      batch.acknowledgedAt = new Date().toISOString();
      for (const bid of this.bids) {
        if (bid.auctionId === batch.auctionId && bid.status === 'Pending submission') {
          bid.status = 'Submitted';
        }
      }
    }, this.botAckMs);
    return this.respond(batch);
  }

  async reconciliation() {
    const rows = this.recon;
    return this.respond({
      auctionName: '364-day Treasury Bill',
      auctionDate: '2026-09-10T07:00:00Z',
      valueDate: '2026-09-12T07:00:00Z',
      records: 1102,
      matched: 1099 + rows.filter((r) => r.result === 'Resolved').length,
      rows,
    });
  }

  async resolveBreak(rowId: string, actor: SessionUser) {
    this.requirePermission(actor, PERMISSIONS.settlementReconcile);
    const row = this.recon.find((r) => r.id === rowId);
    if (!row) throw new ApiError('NOT_FOUND', 'Record not found.');
    if (row.result !== 'Break')
      throw new ApiError('INVALID_STATE', 'This record has no open break.');
    row.result = 'Resolved';
    row.resolvedBy = { id: actor.id, name: shortName(actor.name), at: this.now().toISOString() };
    return this.respond(row);
  }
}

/** "Rose Mollel" → "R. Mollel", as the design shows actors. */
function shortName(name: string): string {
  const [first = '', ...rest] = name.split(' ');
  return rest.length ? `${first.charAt(0)}. ${rest.join(' ')}` : first;
}

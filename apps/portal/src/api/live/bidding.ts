import { fundsHold } from '../../lib/bid-math';
import type { Auction, Batch, BatchStage, Bid, BidStatus, InvestorSummary, PlaceBidRequest } from '../types';
import { request } from './http';

/**
 * The auction service, mapped into the shapes the investor and Bid submission screens
 * already render. The screens do not know whether they are live or mocked.
 */

interface AuctionDto {
  isin: string;
  name: string;
  instrument: 'bill' | 'bond';
  tenorDays: number | null;
  auctionDate: string | null;
  maturityDate: string | null;
  offerSize: string;
  cutoffAt: string | null;
  state: 'open' | 'closed_for_bids' | 'closed';
  rules: { minimumBid: string; bidMultiple: string; commissionBps: number };
  indicativePrice: string;
}

interface BidDto {
  reference: string;
  isin: string;
  security: string;
  auctionDate: string | null;
  cutoffAt: string | null;
  competitive: boolean;
  faceValue: string;
  price: string | null;
  held: string;
  status: string;
  allottedFaceValue: string | null;
  allottedPrice: string | null;
  placedAt: string;
}

interface FundsDto {
  bankAccount: string | null;
  available: string | null;
  onHold: string | null;
  canBid: boolean;
  cdsAccount: string | null;
  firstName?: string | null;
}

/** "364-DAY TREASURY BILL" → "364-day Treasury Bill" */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/(\d)-Day/g, '$1-day')
    .replace(/(\d)-Year/g, '$1-year');
}

function toAuction(a: AuctionDto): Auction {
  const days = a.tenorDays ?? 364;
  return {
    id: a.isin,
    isin: a.isin,
    name: titleCase(a.name),
    instrument:
      a.instrument === 'bond'
        ? { kind: 'bond', years: Math.max(1, Math.round(days / 365)), couponRate: '—' }
        : { kind: 'bill', days },
    auctionDate: a.auctionDate ? `${a.auctionDate}T07:00:00.000Z` : (a.cutoffAt ?? new Date().toISOString()),
    cutoffAt: a.cutoffAt ?? new Date().toISOString(),
    offerSize: a.offerSize.replace(/\.00$/, ''),
    rules: a.rules,
    status: a.state === 'open' ? 'Open' : 'Closed',
    indicativePrice: a.indicativePrice,
  };
}

const STATUS: Record<string, BidStatus> = {
  placed: 'Pending submission',
  // In a batch: no longer withdrawable, so shown as on its way to BoT.
  in_batch: 'Submitted',
  submitted: 'Submitted',
  accepted: 'Submitted',
  allotted: 'Allotted',
  partially_allotted: 'Partially allotted',
  unsuccessful: 'Unsuccessful',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

function toBid(b: BidDto): Bid {
  return {
    reference: b.reference,
    auctionId: b.isin,
    security: titleCase(b.security),
    auctionDate: b.auctionDate ?? b.placedAt,
    cutoffAt: b.cutoffAt ?? b.placedAt,
    type: b.competitive ? 'Competitive' : 'Non-competitive',
    faceValue: b.faceValue,
    price: b.price,
    allotted: b.allottedFaceValue,
    heldAmount: b.held,
    status: STATUS[b.status] ?? 'Submitted',
  };
}

const OPEN = ['placed', 'in_batch', 'submitted', 'accepted'];

export const biddingApi = {
  auctions: async () => (await request<AuctionDto[]>('auction', '/v1/auctions')).map(toAuction),
  myBids: async () => (await request<BidDto[]>('auction', '/v1/bids')).map(toBid),

  async summary(fallbackName: string): Promise<InvestorSummary> {
    const [funds, bids] = await Promise.all([
      request<FundsDto>('auction', '/v1/me/funds'),
      request<BidDto[]>('auction', '/v1/bids'),
    ]);
    const account = funds.bankAccount ?? '';
    return {
      firstName: funds.firstName ?? fallbackName,
      cdsAccount: funds.cdsAccount ?? '—',
      settlementAccount: {
        label: 'TCB account',
        masked: account ? `${account.slice(0, 4)}•••${account.slice(-4)}` : '—',
      },
      availableBalance: funds.available ?? '0.00',
      fundsOnHold: funds.onHold ?? '0.00',
      openBidCount: bids.filter((b) => OPEN.includes(b.status)).length,
      weightedYield: '0.00',
      couponTaxRate: '10',
    };
  },

  /**
   * Approve with the PIN for exactly what will be held, then place. The idempotency
   * key makes a retry after a dropped connection return the same bid, not a second one.
   */
  async placeBid(req: PlaceBidRequest, auction: Auction): Promise<Bid> {
    const competitive = req.type === 'Competitive';
    const hold = fundsHold(req.faceValue, auction.rules, competitive ? req.price : null);
    const { stepUpToken } = await request<{ stepUpToken: string }>('identity', '/v1/auth/step-up', {
      method: 'POST',
      body: { pin: req.pin, scope: 'bid:place', amount: hold },
    });
    const bid = await request<BidDto>('auction', '/v1/bids', {
      method: 'POST',
      body: { isin: req.auctionId, competitive, faceValue: req.faceValue, price: competitive ? req.price : null },
      headers: { 'x-step-up-token': stepUpToken, 'idempotency-key': crypto.randomUUID() },
    });
    return toBid(bid);
  },

  withdraw: (reference: string) =>
    request<BidDto>('auction', `/v1/bids/${encodeURIComponent(reference)}/withdraw`, { method: 'POST' }),
};

// ---------------------------------------------------------------- back office

interface ControlDto {
  isin: string;
  name: string;
  cutoffAt: string | null;
  state: 'open' | 'closed_for_bids' | 'closed';
  bids: number;
  competitive: number;
  nonCompetitive: number;
  faceValue: string;
  held: string;
  awaitingBatch: number;
  batch: { id: string; reference: string; status: string; preparedByName: string | null; approvedByName: string | null } | null;
}

interface BatchDetailDto {
  id: string;
  reference: string;
  status: string;
  preparedBy: string | null;
  preparedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  lastError: string | null;
}

export interface LiveBatch extends Batch {
  /** Whether the next action is to prepare (no batch yet) or act on an existing one. */
  batchId: string | null;
  lastError: string | null;
  failed: boolean;
}

function stageOf(c: ControlDto, batch: BatchDetailDto | null): BatchStage {
  if (!batch) return c.state === 'open' ? 'Awaiting consolidation' : 'Awaiting maker';
  switch (batch.status) {
    case 'prepared':
      return 'Awaiting checker';
    case 'approved':
    case 'failed':
      return 'Submitting';
    default:
      return 'Acknowledged by BoT';
  }
}

export const submissionApi = {
  async batches(): Promise<LiveBatch[]> {
    const control = await request<ControlDto[]>('auction', '/v1/staff/auctions');
    const rows = control.filter((c) => c.bids > 0 || c.state === 'open');
    return Promise.all(
      rows.map(async (c) => {
        const batch = c.batch ? await request<BatchDetailDto>('auction', `/v1/staff/batches/${c.batch.id}`) : null;
        // A new batch is due when bids are waiting that no batch holds yet.
        const current = batch && !(c.awaitingBatch > 0 && batch.status !== 'prepared') ? batch : null;
        return {
          id: current?.id ?? c.isin,
          batchId: current?.id ?? null,
          auctionId: c.isin,
          name: titleCase(c.name),
          isin: c.isin,
          cutoffAt: c.cutoffAt ?? new Date().toISOString(),
          bids: c.bids,
          competitive: c.competitive,
          nonCompetitive: c.nonCompetitive,
          faceValue: c.faceValue,
          fundsHeld: c.held,
          stage: stageOf(c, current),
          consolidatedAt: c.cutoffAt ?? new Date().toISOString(),
          preparedBy: current?.preparedBy ? { id: '', name: current.preparedBy, at: current.preparedAt } : null,
          approvedBy: current?.approvedBy ? { id: '', name: current.approvedBy, at: current.approvedAt ?? '' } : null,
          batchReference: current?.submittedAt ? current.reference : null,
          acknowledgedAt: current?.submittedAt ?? null,
          lastError: current?.lastError ?? null,
          failed: current?.status === 'failed',
        } satisfies LiveBatch;
      }),
    );
  },
  prepare: (isin: string) => request<BatchDetailDto>('auction', '/v1/staff/batches', { method: 'POST', body: { isin } }),
  closeBidding: (isin: string, reason: string) =>
    request<unknown>('auction', `/v1/staff/auctions/${isin}/close-bidding`, { method: 'POST', body: { reason } }),
  /** The checker confirms with their password (development), then approval sends the batch. */
  async approve(batchId: string, password: string): Promise<BatchDetailDto> {
    const { stepUpToken } = await request<{ stepUpToken: string }>('identity', '/v1/auth/staff/step-up', {
      method: 'POST',
      body: { password, scope: 'batch:approve' },
    });
    return request<BatchDetailDto>('auction', `/v1/staff/batches/${batchId}/approve`, {
      method: 'POST',
      headers: { 'x-step-up-token': stepUpToken },
    });
  },
  resubmit: (batchId: string) => request<BatchDetailDto>('auction', `/v1/staff/batches/${batchId}/submit`, { method: 'POST' }),
};

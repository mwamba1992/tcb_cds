import { isValidReference } from '@govsec/reference';
import { PERSONAS } from '../../config/personas';
import { ApiError } from '../types';
import { seedClock } from './data';
import { MockPortalApi } from './mock-api';

const { maker, checker, treasury } = PERSONAS;

function api(balance = '26340000.00') {
  return new MockPortalApi({
    latencyMs: 0,
    botAckMs: 0,
    availableBalance: balance,
    clock: seedClock(),
  });
}

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('placing and withdrawing bids', () => {
  const bid = {
    auctionId: 'A1',
    type: 'Competitive' as const,
    faceValue: '10000000',
    price: '88.50',
    pin: '1234',
  };

  it('holds face value plus commission and issues a valid BD- reference', async () => {
    const platform = api();
    const placed = await platform.placeBid(bid);
    expect(placed.heldAmount).toBe('10010000.00');
    expect(placed.status).toBe('Pending submission');
    expect(isValidReference(placed.reference, 'bid')).toBe(true);
    expect((await platform.investorSummary()).availableBalance).toBe('16330000.00');
  });

  it('refuses a bid the account cannot cover', async () => {
    await rejects(api('6200000.00').placeBid(bid), 'INSUFFICIENT_FUNDS');
  });

  it('refuses a bad amount, a bad price and a bad PIN', async () => {
    const platform = api();
    await rejects(platform.placeBid({ ...bid, faceValue: '550000' }), 'INVALID_BID');
    await rejects(platform.placeBid({ ...bid, price: '111' }), 'INVALID_BID');
    await rejects(platform.placeBid({ ...bid, pin: '12' }), 'INVALID_PIN');
  });

  it('releases the hold on withdrawal, but only before submission', async () => {
    const platform = api();
    const placed = await platform.placeBid(bid);
    const withdrawn = await platform.withdrawBid(placed.reference);
    expect(withdrawn.status).toBe('Withdrawn');
    expect((await platform.investorSummary()).availableBalance).toBe('26340000.00');
    // The seeded 182-day bid is already with BoT.
    await rejects(platform.withdrawBid('BD-0DFN6692'), 'NOT_WITHDRAWABLE');
  });
});

describe('KYC maker-checker', () => {
  it('runs maker approval, then a different checker approves', async () => {
    const platform = api();
    const afterMaker = await platform.actOnKyc('KYC-10482', 'approve', maker);
    expect(afterMaker.status).toBe('Awaiting checker');
    const final = await platform.actOnKyc('KYC-10482', 'final-approve', checker);
    expect(final.status).toBe('Approved');
  });

  it('stops a checker from approving their own maker decision', async () => {
    const platform = api();
    // A supervisor holds kyc:review too, so the server must enforce the second pair of eyes.
    await platform.actOnKyc('KYC-10466', 'approve', checker);
    await rejects(platform.actOnKyc('KYC-10466', 'final-approve', checker), 'MAKER_CHECKER');
  });

  it('refuses roles without KYC permissions', async () => {
    await rejects(api().actOnKyc('KYC-10482', 'approve', treasury), 'FORBIDDEN');
  });

  it('returns a case to the maker', async () => {
    const platform = api();
    await platform.actOnKyc('KYC-10471', 'approve', maker);
    expect((await platform.actOnKyc('KYC-10471', 'return', checker)).status).toBe('Returned');
  });
});

describe('batch submission to BoT', () => {
  it('prepares, approves, submits and is acknowledged', async () => {
    const platform = api();
    const prepared = await platform.prepareBatch('B2', maker);
    expect(prepared.stage).toBe('Awaiting checker');
    const approved = await platform.approveBatch('B2', checker);
    expect(approved.stage).toBe('Submitting');
    expect(approved.batchReference).toMatch(/^[A-Z0-9]{8}-\d{6}-\d{3}$/);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [, b2] = await platform.batches();
    expect(b2?.stage).toBe('Acknowledged by BoT');
    expect(b2?.acknowledgedAt).not.toBeNull();
  });

  it('marks the batch’s pending bids as submitted once BoT acknowledges', async () => {
    const platform = api();
    const placed = await platform.placeBid({
      auctionId: 'A1',
      type: 'Non-competitive',
      faceValue: '1000000',
      price: null,
      pin: '0000',
    });
    await platform.approveBatch('B1', checker);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const mine = (await platform.myBids()).find((b) => b.reference === placed.reference);
    expect(mine?.status).toBe('Submitted');
  });

  it('refuses the maker approving their own batch, and a checker preparing', async () => {
    const platform = api();
    await platform.prepareBatch('B2', maker);
    await rejects(platform.approveBatch('B2', { ...checker, id: maker.id }), 'MAKER_CHECKER');
    await rejects(api().prepareBatch('B2', checker), 'FORBIDDEN');
  });
});

describe('reconciliation', () => {
  it('lets treasury resolve a break, and counts it as matched', async () => {
    const platform = api();
    const resolved = await platform.resolveBreak('R2', treasury);
    expect(resolved.result).toBe('Resolved');
    expect(resolved.resolvedBy?.name).toBe('F. Mrema');
    expect((await platform.reconciliation()).matched).toBe(1100);
  });

  it('refuses operations roles', async () => {
    await rejects(api().resolveBreak('R2', checker), 'FORBIDDEN');
  });
});

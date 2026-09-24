import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  api,
  type Auction,
  type Bid,
  type Cashflow,
  type Holding,
  type InvestorSummary,
  type PlaceBidRequest,
} from '../api';
import { biddingApi } from '../api/live/bidding';
import { LIVE_AUTH } from '../config/portal';
import { useAccountStore } from './account';

/** The signed-in investor's view of the platform. */
export const useInvestorStore = defineStore('investor', () => {
  const summary = ref<InvestorSummary | null>(null);
  const auctions = ref<Auction[]>([]);
  const holdings = ref<Holding[]>([]);
  const cashflows = ref<Cashflow[]>([]);
  const bids = ref<Bid[]>([]);
  const loaded = ref(false);

  /**
   * With live sign-in, auctions, bids and funds come from the auction service. Holdings
   * and payments stay empty until settlement credits securities (the next round):
   * showing sample holdings to a real customer would be worse than showing none.
   */
  async function load() {
    if (LIVE_AUTH) {
      const account = useAccountStore();
      const ready = account.onboarding?.canBid ?? false;
      const [s, a, b] = await Promise.all([
        ready ? biddingApi.summary(account.onboarding?.profile?.firstName ?? '') : Promise.resolve(null),
        biddingApi.auctions(),
        ready ? biddingApi.myBids() : Promise.resolve([]),
      ]);
      summary.value = s;
      auctions.value = a;
      holdings.value = [];
      cashflows.value = [];
      bids.value = b;
      loaded.value = true;
      return;
    }
    const [s, a, h, c, b] = await Promise.all([
      api.investorSummary(),
      api.auctions(),
      api.holdings(),
      api.cashflows(),
      api.myBids(),
    ]);
    summary.value = s;
    auctions.value = a;
    holdings.value = h;
    cashflows.value = c;
    bids.value = b;
    loaded.value = true;
  }

  async function refreshAccount() {
    if (LIVE_AUTH) {
      const account = useAccountStore();
      const [s, b] = await Promise.all([
        biddingApi.summary(account.onboarding?.profile?.firstName ?? ''),
        biddingApi.myBids(),
      ]);
      summary.value = s;
      bids.value = b;
      return;
    }
    const [s, b] = await Promise.all([api.investorSummary(), api.myBids()]);
    summary.value = s;
    bids.value = b;
  }

  async function placeBid(request: PlaceBidRequest): Promise<Bid> {
    const target = auction(request.auctionId);
    const bid = LIVE_AUTH && target ? await biddingApi.placeBid(request, target) : await api.placeBid(request);
    await refreshAccount();
    return bid;
  }

  async function withdraw(reference: string) {
    if (LIVE_AUTH) await biddingApi.withdraw(reference);
    else await api.withdrawBid(reference);
    await refreshAccount();
  }

  function auction(id: string): Auction | undefined {
    return auctions.value.find((a) => a.id === id);
  }

  return {
    summary,
    auctions,
    holdings,
    cashflows,
    bids,
    loaded,
    load,
    placeBid,
    withdraw,
    auction,
  };
});

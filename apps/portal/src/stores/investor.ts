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

/** The signed-in investor's view of the platform. */
export const useInvestorStore = defineStore('investor', () => {
  const summary = ref<InvestorSummary | null>(null);
  const auctions = ref<Auction[]>([]);
  const holdings = ref<Holding[]>([]);
  const cashflows = ref<Cashflow[]>([]);
  const bids = ref<Bid[]>([]);
  const loaded = ref(false);

  async function load() {
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
    const [s, b] = await Promise.all([api.investorSummary(), api.myBids()]);
    summary.value = s;
    bids.value = b;
  }

  async function placeBid(request: PlaceBidRequest): Promise<Bid> {
    const bid = await api.placeBid(request);
    await refreshAccount();
    return bid;
  }

  async function withdraw(reference: string) {
    await api.withdrawBid(reference);
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

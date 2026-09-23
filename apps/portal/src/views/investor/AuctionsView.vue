<script setup lang="ts">
import { computed } from 'vue';
import StatusChip from '../../components/StatusChip.vue';
import { useNow } from '../../composables/useNow';
import { formatAmount, formatCompact } from '../../lib/money';
import { formatAuctionDate, formatCountdown, formatCutoff } from '../../lib/time';
import { useInvestorStore } from '../../stores/investor';

const store = useInvestorStore();
const now = useNow();

const rows = computed(() =>
  store.auctions.map((a) => ({
    ...a,
    countdown:
      a.status === 'Open'
        ? `Closes in ${formatCountdown(new Date(a.cutoffAt).getTime() - now.value)}`
        : '',
  })),
);
</script>

<template>
  <p class="lead">
    Auctions are published by the Bank of Tanzania. Funds for your bid are held on your settlement
    account when you place it and released straight away for any amount not allotted.
  </p>
  <div class="card scroll-x">
    <table class="table auctions">
      <thead>
        <tr>
          <th>Security</th>
          <th>Auction date</th>
          <th>Bids close</th>
          <th class="right">Offer size</th>
          <th class="right">Minimum bid</th>
          <th>Status</th>
          <th><span class="visually-hidden">Action</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in rows" :key="a.id">
          <td>
            <div class="cell-title">{{ a.name }}</div>
            <div class="cell-sub mono">{{ a.isin }}</div>
          </td>
          <td class="nowrap">{{ formatAuctionDate(a.auctionDate) }}</td>
          <td class="nowrap">
            <div>{{ formatCutoff(a.cutoffAt) }}</div>
            <div class="cell-sub countdown">{{ a.countdown }}</div>
          </td>
          <td class="right num nowrap">TZS {{ formatCompact(a.offerSize) }}</td>
          <td class="right num nowrap">{{ formatAmount(a.rules.minimumBid) }}</td>
          <td><StatusChip :status="a.status" /></td>
          <td class="right">
            <RouterLink
              v-if="a.status === 'Open'"
              :to="{ name: 'investor-bid', params: { auctionId: a.id } }"
              class="btn btn-primary btn--md"
            >
              Place bid
            </RouterLink>
            <span v-else-if="a.opensAt" class="muted opens"
              >Opens {{ formatAuctionDate(a.opensAt).slice(0, -5) }}</span
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.auctions {
  min-width: 820px;
}
.btn {
  text-decoration: none;
  display: inline-block;
}
.opens {
  font-size: 13px;
  white-space: nowrap;
}
</style>

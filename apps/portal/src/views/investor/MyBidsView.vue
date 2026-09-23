<script setup lang="ts">
import { ref } from 'vue';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { formatAmount } from '../../lib/money';
import { formatAuctionDate } from '../../lib/time';
import { useInvestorStore } from '../../stores/investor';

const store = useInvestorStore();
const { error, run } = useAsync();
const withdrawing = ref<string | null>(null);

async function withdraw(reference: string) {
  withdrawing.value = reference;
  await run(() => store.withdraw(reference));
  withdrawing.value = null;
}
</script>

<template>
  <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  <div class="card scroll-x">
    <table class="table bids">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Security</th>
          <th>Type</th>
          <th class="right">Amount (TZS)</th>
          <th class="right">Price</th>
          <th class="right">Allotted (TZS)</th>
          <th>Status</th>
          <th><span class="visually-hidden">Action</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in store.bids" :key="b.reference">
          <td class="mono ref">{{ b.reference }}</td>
          <td>
            <div class="cell-title">{{ b.security }}</div>
            <div class="cell-sub">Auction {{ formatAuctionDate(b.auctionDate) }}</div>
          </td>
          <td>{{ b.type }}</td>
          <td class="right num">{{ formatAmount(b.faceValue) }}</td>
          <td class="right num">{{ b.price ?? 'WAP' }}</td>
          <td class="right num">{{ b.allotted === null ? '—' : formatAmount(b.allotted) }}</td>
          <td><StatusChip :status="b.status" /></td>
          <td class="right">
            <button
              v-if="b.status === 'Pending submission'"
              type="button"
              class="btn btn-danger btn--sm"
              :disabled="withdrawing === b.reference"
              @click="withdraw(b.reference)"
            >
              {{ withdrawing === b.reference ? 'Withdrawing…' : 'Withdraw' }}
            </button>
          </td>
        </tr>
        <tr v-if="store.loaded && store.bids.length === 0">
          <td colspan="8" class="muted">You have not placed any bids yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="muted footnote">
    WAP: weighted average price, set by the Bank of Tanzania at the auction. A bid can be withdrawn
    until TCB submits it to BoT.
  </p>
</template>

<style scoped>
.bids {
  min-width: 760px;
}
.ref {
  font-size: 13px;
}
.footnote {
  font-size: 13px;
  margin: 0;
}
</style>

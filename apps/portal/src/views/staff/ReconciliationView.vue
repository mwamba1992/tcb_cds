<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { computed, ref } from 'vue';
import type { ReconRow } from '../../api';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { formatAmount } from '../../lib/money';
import { formatAuctionDate, formatDate } from '../../lib/time';
import { useOperationsStore } from '../../stores/operations';
import { useSessionStore } from '../../stores/session';

const ops = useOperationsStore();
const session = useSessionStore();
const { error, run } = useAsync();
const resolving = ref<string | null>(null);

const r = computed(() => ops.recon);
const open = computed(() => r.value?.rows.filter((row) => row.result === 'Break').length ?? 0);
const canResolve = computed(() => session.can(PERMISSIONS.settlementReconcile));

const amount = (value: string | null) => (value === null ? '—' : formatAmount(value));
const detail = (row: ReconRow) =>
  row.result === 'Resolved' && row.resolvedBy
    ? `Resolved by ${row.resolvedBy.name} · ${row.detail}`
    : row.detail;

async function resolve(id: string) {
  resolving.value = id;
  await run(() => ops.resolveBreak(id));
  resolving.value = null;
}
</script>

<template>
  <template v-if="r">
    <div class="head">
      <div>
        <h2 class="card-title">
          {{ r.auctionName }} · Auction {{ formatDate(r.auctionDate).replace(/^0/, '') }}
        </h2>
        <div class="card-sub">
          Value date {{ formatAuctionDate(r.valueDate).slice(4) }} · Platform allocations ↔ CBS
          postings ↔ CDS holdings
        </div>
      </div>
      <div class="totals">
        <div>
          <div class="muted total-label">Records</div>
          <div class="total-value num">{{ r.records.toLocaleString('en-US') }}</div>
        </div>
        <div>
          <div class="muted total-label">Matched</div>
          <div class="total-value num good">{{ r.matched.toLocaleString('en-US') }}</div>
        </div>
        <div>
          <div class="muted total-label">Open breaks</div>
          <div class="total-value num bad">{{ open }}</div>
        </div>
      </div>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div class="card scroll-x">
      <table class="table recon">
        <thead>
          <tr>
            <th>Investor</th>
            <th class="right">Allocation</th>
            <th class="right">CBS debit</th>
            <th class="right">CDS credit</th>
            <th>Result</th>
            <th>Detail</th>
            <th><span class="visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in r.rows" :key="row.id">
            <td>
              <div class="cell-title">{{ row.investor }}</div>
              <div class="cell-sub mono">{{ row.cdsAccount }}</div>
            </td>
            <td class="right num">{{ amount(row.allocation) }}</td>
            <td
              class="right num"
              :class="{ bad: row.result === 'Break' && row.breakSide === 'cbs' }"
            >
              {{ amount(row.cbsDebit) }}
            </td>
            <td
              class="right num"
              :class="{ bad: row.result === 'Break' && row.breakSide === 'cds' }"
            >
              {{ amount(row.cdsCredit) }}
            </td>
            <td><StatusChip :status="row.result" /></td>
            <td class="muted detail">{{ detail(row) }}</td>
            <td class="right">
              <button
                v-if="row.result === 'Break' && row.action && canResolve"
                type="button"
                class="btn btn-outline btn--sm"
                :disabled="resolving === row.id"
                @click="resolve(row.id)"
              >
                {{ row.action }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
  <p v-else class="muted" role="status">Loading reconciliation…</p>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}
.totals {
  display: flex;
  gap: 28px;
}
.total-label {
  font-size: 12px;
}
.total-value {
  font-size: 18px;
  font-weight: 600;
}
.good {
  color: var(--green-fg);
}
.bad {
  color: var(--red-fg);
}
.recon {
  min-width: 820px;
}
.detail {
  font-size: 13px;
  max-width: 280px;
}
</style>

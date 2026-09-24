<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { computed, ref } from 'vue';
import type { ReconRow } from '../../api';
import DataTable, { type Column } from '../../components/DataTable.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { useLocalTable } from '../../composables/useTable';
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

const RESULT_ORDER: Record<string, number> = { Break: 0, Resolved: 1, Matched: 2 };
const table = useLocalTable<ReconRow>(() => r.value?.rows ?? [], {
  search: (row, q) => `${row.investor} ${row.cdsAccount}`.toLowerCase().includes(q),
  sorters: {
    investor: (row) => row.investor,
    allocation: (row) => Number(row.allocation ?? 0),
    result: (row) => RESULT_ORDER[row.result] ?? 9,
  },
  sort: 'result:asc',
});
const columns: Column[] = [
  { key: 'investor', label: 'Investor', sort: 'investor' },
  { key: 'allocation', label: 'Allocation', align: 'right', sort: 'allocation' },
  { key: 'cbsDebit', label: 'CBS debit', align: 'right' },
  { key: 'cdsCredit', label: 'CDS credit', align: 'right' },
  { key: 'result', label: 'Result', sort: 'result' },
  { key: 'detail', label: 'Detail' },
  { key: 'action', label: 'Action', hiddenLabel: true, align: 'right' },
];
const rr = (x: Record<string, unknown>) => x as unknown as ReconRow;

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

    <div class="card">
      <DataTable
        v-bind="table.bind.value"
        :columns="columns"
        row-key="id"
        search-placeholder="Search by investor or CDS account"
        empty="No rows match."
      >
        <template #cell-investor="{ row }">
          <div class="cell-title">{{ rr(row).investor }}</div>
          <div class="cell-sub mono">{{ rr(row).cdsAccount }}</div>
        </template>
        <template #cell-allocation="{ row }"><span class="num">{{ amount(rr(row).allocation) }}</span></template>
        <template #cell-cbsDebit="{ row }">
          <span class="num" :class="{ bad: rr(row).result === 'Break' && rr(row).breakSide === 'cbs' }">{{ amount(rr(row).cbsDebit) }}</span>
        </template>
        <template #cell-cdsCredit="{ row }">
          <span class="num" :class="{ bad: rr(row).result === 'Break' && rr(row).breakSide === 'cds' }">{{ amount(rr(row).cdsCredit) }}</span>
        </template>
        <template #cell-result="{ row }"><StatusChip :status="rr(row).result" /></template>
        <template #cell-detail="{ row }"><span class="muted detail">{{ detail(rr(row)) }}</span></template>
        <template #cell-action="{ row }">
          <button
            v-if="rr(row).result === 'Break' && rr(row).action && canResolve"
            type="button"
            class="btn btn-outline btn--sm"
            :disabled="resolving === rr(row).id"
            @click="resolve(rr(row).id)"
          >
            {{ rr(row).action }}
          </button>
        </template>
      </DataTable>
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
.detail {
  display: inline-block;
  font-size: 13px;
  max-width: 280px;
}
</style>

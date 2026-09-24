<script setup lang="ts">
import { useRouter } from 'vue-router';
import { registersApi, type CustomerRow } from '../../api/live/backoffice';
import DataTable, { type Column } from '../../components/DataTable.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useTable } from '../../composables/useTable';
import { LIVE_AUTH } from '../../config/portal';
import { capitalise, customerStatusLabel, riskTone } from '../../lib/status';
import { formatDate } from '../../lib/time';

const router = useRouter();
const table = useTable<CustomerRow>(registersApi.customers, {
  sort: 'registered:desc',
  filters: { status: '' },
});

const columns: Column[] = [
  { key: 'name', label: 'Customer' },
  { key: 'nidaNumber', label: 'NIDA number', nowrap: true },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'risk', label: 'Risk', sort: 'risk' },
  { key: 'bankAccount', label: 'TCB account', nowrap: true },
  { key: 'cdsAccount', label: 'CDS account', nowrap: true },
  { key: 'registeredAt', label: 'Registered', sort: 'registered', nowrap: true },
];

const STATUSES = [
  { value: '', label: 'All customers' },
  { value: 'ready', label: 'Ready to bid' },
  { value: 'awaiting_accounts', label: 'Awaiting accounts' },
  { value: 'under_review', label: 'Under review' },
  { value: 'info_requested', label: 'Info requested' },
  { value: 'draft', label: 'Draft' },
  { value: 'rejected', label: 'Rejected' },
];

const row = (r: Record<string, unknown>) => r as unknown as CustomerRow;
</script>

<template>
  <section class="card">
    <div class="card-head--lg">
      <h2 class="card-title">Customers</h2>
      <p class="card-sub">Everyone who has registered. Open a customer to see their details, checks and history.</p>
    </div>
    <p v-if="!LIVE_AUTH" class="notice pad">Available with live sign-in.</p>
    <DataTable
      v-else
      v-bind="table.bind.value"
      :columns="columns"
      row-key="reference"
      search-placeholder="Search by name, NV- reference, phone or NIDA number"
      empty="No customers match."
      clickable
      @row-click="(r) => router.push({ name: 'staff-customer', params: { reference: row(r).reference } })"
    >
      <template #filters>
        <select v-model="table.filters.status" class="input input--text filter" aria-label="Status">
          <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </template>
      <template #cell-name="{ row: r }">
        <div class="cell-title">{{ row(r).name ?? 'No details yet' }}</div>
        <div class="cell-sub mono">{{ row(r).reference }}</div>
      </template>
      <template #cell-nidaNumber="{ row: r }"><span class="mono">{{ row(r).nidaNumber ?? '—' }}</span></template>
      <template #cell-status="{ row: r }">
        <StatusChip :status="customerStatusLabel(row(r).status, row(r).canBid)" small />
      </template>
      <template #cell-risk="{ row: r }">
        <StatusChip v-if="row(r).risk" :status="capitalise(row(r).risk)" :tone="riskTone(capitalise(row(r).risk) as 'Low')" small />
        <span v-else class="muted">—</span>
      </template>
      <template #cell-bankAccount="{ row: r }">
        <span v-if="row(r).bankAccount" class="mono">{{ row(r).bankAccount }}</span>
        <span v-else-if="row(r).bankStatus === 'requested'" class="muted">Being opened</span>
        <span v-else class="muted">—</span>
      </template>
      <template #cell-cdsAccount="{ row: r }">
        <span v-if="row(r).cdsAccount" class="mono">{{ row(r).cdsAccount }}</span>
        <span v-else-if="row(r).cdsStatus === 'requested'" class="muted">Requested</span>
        <span v-else class="muted">—</span>
      </template>
      <template #cell-registeredAt="{ row: r }">{{ formatDate(row(r).registeredAt) }}</template>
    </DataTable>
  </section>
</template>

<style scoped>
.pad {
  margin: 0 24px 24px;
}
.filter {
  font-size: 14px;
  padding: 8px 10px;
}
</style>

<script setup lang="ts">
import { registersApi, type BankAccountRow } from '../../api/live/backoffice';
import DataTable, { type Column } from '../../components/DataTable.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useTable } from '../../composables/useTable';
import { LIVE_AUTH } from '../../config/portal';
import { capitalise } from '../../lib/status';
import { formatDate } from '../../lib/time';

/**
 * The TCB account behind each customer: the one bids are paid from and interest and
 * maturities are paid into. Existing customers' accounts are linked at registration;
 * new-to-bank customers' are requested from Core Banking on approval.
 */
const table = useTable<BankAccountRow>(registersApi.bankAccounts, { sort: 'registered:desc', filters: { status: '' } });
const columns: Column[] = [
  { key: 'name', label: 'Customer' },
  { key: 'bankStatus', label: 'Status', sort: 'status' },
  { key: 'bankAccount', label: 'TCB account', nowrap: true },
  { key: 'cbsCustomerId', label: 'CBS customer', nowrap: true },
  { key: 'openingReference', label: 'Opening request', nowrap: true },
  { key: 'approvedAt', label: 'Approved', nowrap: true },
];
const STATUSES = [
  { value: '', label: 'All accounts' },
  { value: 'existing', label: 'Existing (linked)' },
  { value: 'requested', label: 'Being opened' },
  { value: 'opened', label: 'Opened for us' },
];
const row = (r: Record<string, unknown>) => r as unknown as BankAccountRow;
</script>

<template>
  <section class="card">
    <div class="card-head--lg">
      <h2 class="card-title">TCB accounts</h2>
      <p class="card-sub">Settlement accounts linked to customers, and accounts being opened for new-to-bank customers.</p>
    </div>
    <p v-if="!LIVE_AUTH" class="notice pad">Available with live sign-in.</p>
    <DataTable
      v-else
      v-bind="table.bind.value"
      :columns="columns"
      row-key="investorReference"
      search-placeholder="Search by account number, request reference, name or NV- reference"
      empty="No accounts match."
    >
      <template #filters>
        <select v-model="table.filters.status" class="input input--text filter" aria-label="Status">
          <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </template>
      <template #cell-name="{ row: r }">
        <RouterLink class="cell-title link-row" :to="{ name: 'staff-customer', params: { reference: row(r).investorReference } }">{{
          row(r).name
        }}</RouterLink>
        <div class="cell-sub mono">{{ row(r).investorReference }}</div>
      </template>
      <template #cell-bankStatus="{ row: r }"><StatusChip :status="capitalise(row(r).bankStatus)" small /></template>
      <template #cell-bankAccount="{ row: r }">
        <span v-if="row(r).bankAccount" class="mono">{{ row(r).bankAccount }}</span><span v-else class="muted">—</span>
      </template>
      <template #cell-cbsCustomerId="{ row: r }"><span class="mono">{{ row(r).cbsCustomerId ?? '—' }}</span></template>
      <template #cell-openingReference="{ row: r }"><span class="mono">{{ row(r).openingReference ?? '—' }}</span></template>
      <template #cell-approvedAt="{ row: r }">{{ row(r).approvedAt ? formatDate(row(r).approvedAt as string) : '—' }}</template>
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
.link-row {
  color: var(--navy);
  text-decoration: none;
}
</style>

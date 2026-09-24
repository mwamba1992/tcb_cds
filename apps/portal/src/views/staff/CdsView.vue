<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { registersApi, type CdsRegisterRow, type CdsTask } from '../../api/live/backoffice';
import DataTable, { type Column } from '../../components/DataTable.vue';
import SegmentedControl from '../../components/SegmentedControl.vue';
import { useAsync } from '../../composables/useAsync';
import { useNow } from '../../composables/useNow';
import { useLocalTable, useTable } from '../../composables/useTable';
import { LIVE_AUTH } from '../../config/portal';
import { formatAge, formatDateTime } from '../../lib/time';
import { useOperationsStore } from '../../stores/operations';

/**
 * CDS accounts: the task list of approved investors still waiting for one, and the
 * register of every account recorded.
 *
 * BoT's GSS API has no CDS endpoint, so an officer opens the account in the CDS and
 * records its number here. The number is what every bid is submitted under, so it is
 * typed twice and the server refuses one that belongs to someone else.
 */
const ops = useOperationsStore();
const route = useRoute();
const router = useRouter();
const now = useNow(30_000);
const { pending, error, run } = useAsync();

type Tab = 'open' | 'register';
const tab = computed<Tab>({
  get: () => (route.query['tab'] === 'register' ? 'register' : 'open'),
  set: (next) => void router.replace({ query: { ...route.query, tab: next } }),
});
const tabs = computed(() => [
  { value: 'open' as Tab, label: `To open${ops.cdsTasks.length ? ` (${ops.cdsTasks.length})` : ''}` },
  { value: 'register' as Tab, label: 'Register' },
]);

// ---- to open

const entry = reactive<Record<string, { value: string; again: string }>>({});
const recorded = ref<{ name: string; account: string; canBid: boolean } | null>(null);
const draft = (ref: string) => (entry[ref] ??= { value: '', again: '' });
const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
const ready = (ref: string) => {
  const d = draft(ref);
  return /^[A-Z0-9-]{4,20}$/.test(d.value) && d.value === d.again;
};

async function complete(reference: string, name: string) {
  const d = draft(reference);
  const account = d.value;
  recorded.value = null;
  const result = await run(() => ops.completeCds(reference, account));
  if (result) {
    delete entry[reference];
    recorded.value = { name, account, canBid: result.canBid };
    void register.reload();
  }
}

const openColumns: Column[] = [
  { key: 'name', label: 'Investor', sort: 'name' },
  { key: 'nidaNumber', label: 'NIDA number', nowrap: true },
  { key: 'bankAccount', label: 'TCB account', nowrap: true },
  { key: 'requestedAt', label: 'Waiting', nowrap: true, sort: 'waiting' },
  { key: 'entry', label: 'CDS account number' },
  { key: 'action', label: 'Action', hiddenLabel: true, align: 'right' },
];
const task = (r: Record<string, unknown>) => r as unknown as CdsTask;
const openTable = useLocalTable<CdsTask>(() => ops.cdsTasks, {
  search: (t, q) => `${t.name} ${t.investorReference} ${t.nidaNumber ?? ''}`.toLowerCase().includes(q),
  sorters: { waiting: (t) => Date.parse(t.requestedAt), name: (t) => t.name },
  sort: 'waiting:asc',
  loading: () => !ops.loaded,
});

// ---- register

const register = useTable<CdsRegisterRow>(registersApi.cdsRegister, { sort: 'opened:desc' });
const registerColumns: Column[] = [
  { key: 'cdsAccount', label: 'CDS account', sort: 'account', nowrap: true },
  { key: 'name', label: 'Investor' },
  { key: 'recordedBy', label: 'Recorded by' },
  { key: 'recordedAt', label: 'Recorded', sort: 'opened', nowrap: true },
];
const reg = (r: Record<string, unknown>) => r as unknown as CdsRegisterRow;
</script>

<template>
  <section class="card">
    <div class="card-head--lg head">
      <div>
        <h2 class="card-title">CDS accounts</h2>
        <p class="card-sub">
          Open the account in the Bank of Tanzania CDS, then record its number. The investor is told by
          SMS.
        </p>
      </div>
      <SegmentedControl v-if="LIVE_AUTH" v-model="tab" :options="tabs" label="View" />
    </div>

    <p v-if="!LIVE_AUTH" class="notice pad">Available with live sign-in.</p>

    <template v-else-if="tab === 'open'">
      <DataTable
        v-bind="openTable.bind.value"
        :columns="openColumns"
        row-key="reference"
        :error="error"
        search-placeholder="Search by name, NV- reference or NIDA number"
        empty="Nothing waiting. Approved investors appear here."
      >
        <template #cell-name="{ row: r }">
          <div class="cell-title">{{ task(r).name }}</div>
          <div class="cell-sub mono">{{ task(r).investorReference }} · {{ task(r).dateOfBirth }}</div>
        </template>
        <template #cell-nidaNumber="{ row: r }"><span class="mono">{{ task(r).nidaNumber }}</span></template>
        <template #cell-bankAccount="{ row: r }">
          <span v-if="task(r).bankAccount" class="mono">{{ task(r).bankAccount }}</span>
          <span v-else class="muted">Being opened</span>
        </template>
        <template #cell-requestedAt="{ row: r }">
          <span class="mono">{{ formatAge(now - Date.parse(task(r).requestedAt)) }}</span>
        </template>
        <template #cell-entry="{ row: r }">
          <div class="entry">
            <input
              :value="draft(task(r).reference).value"
              class="input input--text mono"
              :aria-label="`CDS account for ${task(r).name}`"
              placeholder="CDS account"
              @input="draft(task(r).reference).value = clean(($event.target as HTMLInputElement).value)"
            />
            <input
              :value="draft(task(r).reference).again"
              class="input input--text mono"
              :aria-label="`CDS account for ${task(r).name}, again`"
              placeholder="Type it again"
              :aria-invalid="draft(task(r).reference).again.length > 0 && draft(task(r).reference).again !== draft(task(r).reference).value"
              @input="draft(task(r).reference).again = clean(($event.target as HTMLInputElement).value)"
            />
          </div>
        </template>
        <template #cell-action="{ row: r }">
          <button
            type="button"
            class="btn btn--md btn-primary"
            :disabled="pending || !ready(task(r).reference)"
            @click="complete(task(r).reference, task(r).name)"
          >
            Record
          </button>
        </template>
      </DataTable>
      <p v-if="recorded" class="notice notice--success pad" role="status">
        CDS account <span class="mono">{{ recorded.account }}</span> recorded for {{ recorded.name }}.
        <template v-if="recorded.canBid">They have been sent an SMS and can now bid.</template>
        <template v-else>Their TCB account is still being opened; the SMS goes when it is ready.</template>
        <button type="button" class="btn-link link" @click="tab = 'register'">See the register</button>
      </p>
    </template>

    <DataTable
      v-else
      v-bind="register.bind.value"
      :columns="registerColumns"
      row-key="cdsAccount"
      search-placeholder="Search by CDS number, name or NV- reference"
      empty="No CDS accounts recorded yet."
    >
      <template #cell-cdsAccount="{ row: r }"><span class="mono strong">{{ reg(r).cdsAccount }}</span></template>
      <template #cell-name="{ row: r }">
        <RouterLink class="cell-title link-row" :to="{ name: 'staff-customer', params: { reference: reg(r).investorReference } }">{{
          reg(r).name
        }}</RouterLink>
        <div class="cell-sub mono">{{ reg(r).investorReference }}</div>
      </template>
      <template #cell-recordedBy="{ row: r }">{{ reg(r).recordedBy ?? '—' }}</template>
      <template #cell-recordedAt="{ row: r }">{{ formatDateTime(reg(r).recordedAt) }}</template>
    </DataTable>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.pad {
  margin: 16px 24px 24px;
}
.entry {
  display: flex;
  gap: 8px;
  min-width: 300px;
}
.entry .input {
  width: 150px;
  padding: 7px 10px;
  font-size: 14px;
}
.link {
  color: var(--navy);
  font-weight: 600;
  text-decoration: underline;
  margin-left: 6px;
}
.link-row {
  color: var(--navy);
  text-decoration: none;
}
.strong {
  font-weight: 600;
}
</style>

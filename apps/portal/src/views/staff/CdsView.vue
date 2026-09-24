<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useAsync } from '../../composables/useAsync';
import { useNow } from '../../composables/useNow';
import { LIVE_AUTH } from '../../config/portal';
import { formatAge } from '../../lib/time';
import { useOperationsStore } from '../../stores/operations';

/**
 * Approved investors waiting for a CDS account.
 *
 * BoT's GSS API has no CDS endpoint, so an officer opens the account in the CDS and
 * records its number here. The number is what every bid is submitted under, so it is
 * typed twice and checked for uniqueness by the server.
 */
const ops = useOperationsStore();
const now = useNow(30_000);
const { pending, error, run } = useAsync();

const entry = reactive<Record<string, { value: string; again: string }>>({});
const recorded = ref<{ name: string; account: string; canBid: boolean } | null>(null);
const draft = (ref: string) => (entry[ref] ??= { value: '', again: '' });
const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);

const tasks = computed(() => ops.cdsTasks);
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
  }
}
</script>

<template>
  <section class="card">
    <div class="card-head--lg">
      <h2 class="card-title">Waiting for a CDS account</h2>
      <p class="card-sub">
        Open the account in the Bank of Tanzania CDS, then record its number here. The investor is
        told by SMS and can bid straight away.
      </p>
    </div>

    <p v-if="!LIVE_AUTH" class="notice empty">Available with live sign-in.</p>
    <p v-else-if="!ops.loaded" class="muted empty" role="status">Loading…</p>
    <p v-else-if="tasks.length === 0" class="notice empty">Nothing waiting. Approved investors appear here.</p>

    <div v-else class="scroll-x">
      <table class="table">
        <thead>
          <tr>
            <th>Investor</th>
            <th>NIDA number</th>
            <th>TCB account</th>
            <th>Waiting</th>
            <th>CDS account number</th>
            <th><span class="visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.reference">
            <td>
              <div class="cell-title">{{ t.name }}</div>
              <div class="cell-sub mono">{{ t.investorReference }} · {{ t.dateOfBirth }}</div>
            </td>
            <td class="mono nowrap">{{ t.nidaNumber }}</td>
            <td class="nowrap">
              <span v-if="t.bankAccount" class="mono">{{ t.bankAccount }}</span>
              <span v-else class="muted">Being opened</span>
            </td>
            <td class="mono nowrap">{{ formatAge(now - Date.parse(t.requestedAt)) }}</td>
            <td>
              <div class="entry">
                <input
                  :value="draft(t.reference).value"
                  class="input input--text mono"
                  :aria-label="`CDS account for ${t.name}`"
                  placeholder="CDS account"
                  @input="draft(t.reference).value = clean(($event.target as HTMLInputElement).value)"
                />
                <input
                  :value="draft(t.reference).again"
                  class="input input--text mono"
                  :aria-label="`CDS account for ${t.name}, again`"
                  placeholder="Type it again"
                  :aria-invalid="draft(t.reference).again.length > 0 && draft(t.reference).again !== draft(t.reference).value"
                  @input="draft(t.reference).again = clean(($event.target as HTMLInputElement).value)"
                />
              </div>
            </td>
            <td>
              <button type="button" class="btn btn--md btn-primary" :disabled="pending || !ready(t.reference)" @click="complete(t.reference, t.name)">
                Record
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="error" class="notice notice--error error" role="alert">{{ error }}</p>
    <p v-if="recorded" class="notice notice--success error" role="status">
      CDS account <span class="mono">{{ recorded.account }}</span> recorded for {{ recorded.name }}.
      <template v-if="recorded.canBid">They have been sent an SMS and can now bid.</template>
      <template v-else>Their TCB account is still being opened; the SMS goes when it is ready.</template>
    </p>
  </section>
</template>

<style scoped>
.empty,
.error {
  margin: 0 24px 24px;
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
</style>

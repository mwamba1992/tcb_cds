<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { registersApi, type CustomerDetail } from '../../api/live/backoffice';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { capitalise, customerStatusLabel, riskTone } from '../../lib/status';
import { formatDate, formatDateTime } from '../../lib/time';

/** One customer in full. Opening this page is recorded in the customer's trail. */
const props = defineProps<{ reference: string }>();
const { pending, error, run } = useAsync();
const c = shallowRef<CustomerDetail | null>(null);

onMounted(async () => {
  c.value = (await run(() => registersApi.customer(props.reference))) ?? null;
});

const canBid = computed(() => c.value?.status === 'approved' && c.value.cds.status === 'active' && !!c.value.bank.account);
const SOURCES: Record<string, string> = { nida: 'NIDA', cbs: 'Core Banking', sanctions: 'Sanctions lists', pep: 'PEP list' };
const OUTCOMES: Record<string, string> = { clear: 'Clear', review: 'Needs review', unavailable: 'Unavailable' };
const ACTIONS: Record<string, string> = {
  'kyc.approve': 'Recommended approval',
  'kyc.final-approve': 'Approved (checker)',
  'kyc.request-info': 'Requested information',
  'kyc.reject': 'Rejected',
  'kyc.return': 'Returned to maker',
  'cds.complete': 'Recorded CDS account',
};
const FUNDS: Record<string, string> = {
  salary: 'Salary',
  business: 'Business income',
  savings: 'Savings',
  pension: 'Pension',
  inheritance: 'Inheritance or gift',
  other: 'Other',
};
</script>

<template>
  <RouterLink :to="{ name: 'staff-customers' }" class="back">‹ All customers</RouterLink>
  <p v-if="pending && !c" class="muted" role="status">Loading…</p>
  <p v-else-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  <template v-else-if="c">
    <section class="card head">
      <div>
        <h2 class="card-title big">{{ c.name ?? 'No details yet' }}</h2>
        <div class="card-sub">
          <span class="mono">{{ c.reference }}</span> · {{ capitalise(c.type) }} · registered {{ formatDate(c.registeredAt) }}
        </div>
      </div>
      <div class="chips">
        <StatusChip :status="customerStatusLabel(c.status, canBid)" />
        <StatusChip v-if="c.risk" :status="`${capitalise(c.risk)} risk`" :tone="riskTone(capitalise(c.risk) as 'Low')" />
      </div>
    </section>

    <div class="grid">
      <section class="card">
        <div class="card-head"><h3 class="card-title">Personal details</h3></div>
        <dl class="facts">
          <dt>NIDA number</dt><dd class="mono">{{ c.nidaNumber ?? '—' }}</dd>
          <dt>Date of birth</dt><dd>{{ c.dateOfBirth ?? '—' }}</dd>
          <dt>Sex</dt><dd>{{ c.gender === 'F' ? 'Female' : c.gender === 'M' ? 'Male' : '—' }}</dd>
          <dt>Mobile</dt><dd class="mono">{{ c.phone ?? '—' }}</dd>
          <dt>Email</dt><dd>{{ c.email ?? '—' }}</dd>
          <dt>Address</dt><dd>{{ c.address ?? '—' }}</dd>
          <dt>Occupation</dt><dd>{{ c.occupation ?? '—' }}</dd>
          <dt>Source of funds</dt><dd>{{ c.sourceOfFunds ? FUNDS[c.sourceOfFunds] : '—' }}</dd>
          <dt>TIN</dt><dd class="mono">{{ c.tin ?? '—' }}</dd>
          <dt>Politically exposed</dt><dd>{{ c.pepDeclared === null ? '—' : c.pepDeclared ? 'Yes (declared)' : 'No' }}</dd>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><h3 class="card-title">Accounts</h3></div>
        <dl class="facts">
          <dt>TCB account</dt>
          <dd>
            <span v-if="c.bank.account" class="mono">{{ c.bank.account }}</span>
            <span v-else-if="c.bank.status === 'requested'">Being opened <span class="mono muted">{{ c.bank.openingRef }}</span></span>
            <span v-else class="muted">—</span>
          </dd>
          <dt>CDS account</dt>
          <dd>
            <span v-if="c.cds.account" class="mono">{{ c.cds.account }}</span>
            <span v-else>{{ c.cds.status === 'requested' ? 'Requested' : '—' }}</span>
          </dd>
          <dt>Submitted</dt><dd>{{ formatDateTime(c.submittedAt) }}</dd>
          <dt>Approved</dt><dd>{{ formatDateTime(c.approvedAt) }}</dd>
        </dl>
        <div class="card-head sub-head"><h3 class="card-title">Checks at submission</h3></div>
        <table class="table table--compact">
          <tbody>
            <tr v-for="k in c.checks" :key="k.source + k.at">
              <td>{{ SOURCES[k.source] ?? k.source }}</td>
              <td>
                <StatusChip :status="OUTCOMES[k.outcome] ?? k.outcome" :tone="k.outcome === 'clear' ? 'green' : 'amber'" small />
              </td>
              <td class="muted small">{{ (k.details.reasons ?? []).join('; ') }}</td>
            </tr>
            <tr v-if="c.checks.length === 0"><td class="muted">Not submitted yet.</td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3 class="card-title">History</h3></div>
      <table class="table table--compact">
        <thead><tr><th>When</th><th>What</th><th>Who</th><th>Note</th></tr></thead>
        <tbody>
          <tr v-for="h in c.history" :key="h.at + h.action">
            <td class="nowrap">{{ formatDateTime(h.at) }}</td>
            <td>{{ ACTIONS[h.action] ?? h.action }} <span class="mono muted small">{{ h.subject }}</span></td>
            <td>{{ h.by ?? '—' }}</td>
            <td class="muted">{{ h.note ?? '' }}</td>
          </tr>
          <tr v-if="c.history.length === 0"><td colspan="4" class="muted">No staff actions yet.</td></tr>
        </tbody>
      </table>
    </section>
  </template>
</template>

<style scoped>
.back {
  color: var(--navy);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}
.head {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.big {
  font-size: 20px;
}
.chips {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 24px;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 24px;
  margin: 0;
  padding: 4px 24px 20px;
  font-size: 14px;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
}
.sub-head {
  border-top: 1px solid var(--border);
}
.small {
  font-size: 12px;
}
</style>

<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { onMounted, ref, shallowRef } from 'vue';
import { usersApi, type CustomerLoginDetail } from '../../api/live/backoffice';
import ReasonDialog from '../../components/ReasonDialog.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { formatDateTime } from '../../lib/time';
import { useSessionStore } from '../../stores/session';

/** One customer's sign-in: lock state, devices, unlock requests and history. */
const props = defineProps<{ id: string }>();
const session = useSessionStore();
const { pending, error, run } = useAsync();
const d = shallowRef<CustomerLoginDetail | null>(null);
const dialog = ref<'sign-out' | 'unlock' | null>(null);
const done = ref<string | null>(null);

async function signOut(reason: string) {
  const r = await usersApi.signOutCustomer(props.id, reason);
  done.value = `Signed out of ${r.sessionsEnded} ${r.sessionsEnded === 1 ? 'device' : 'devices'}.`;
}
async function requestUnlock(reason: string) {
  await usersApi.requestUnlock(props.id, reason);
  done.value = 'Sent to a supervisor for approval.';
}

async function load() {
  d.value = (await run(() => usersApi.customerLogin(props.id))) ?? null;
}
onMounted(load);

const ACTIONS: Record<string, string> = {
  'customer.view': 'Viewed sign-in details',
  'customer.sign_out': 'Signed out everywhere',
  'customer.unlock.request': 'Requested PIN unlock',
  'customer.unlock.approve': 'Approved PIN unlock',
  'customer.unlock.reject': 'Rejected PIN unlock',
};
const device = (ua: string | null) =>
  !ua ? 'Unknown device' : /iPhone|Android|Mobile/i.test(ua) ? 'Mobile browser' : /Windows|Macintosh|Linux/i.test(ua) ? 'Computer browser' : ua.slice(0, 40);
</script>

<template>
  <RouterLink :to="{ name: 'staff-users', query: { tab: 'customers' } }" class="back">‹ Customer logins</RouterLink>
  <p v-if="pending && !d" class="muted" role="status">Loading…</p>
  <p v-else-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  <template v-else-if="d">
    <section class="card head">
      <div>
        <h2 class="card-title big mono">{{ d.phone }}</h2>
        <div class="card-sub">Registered {{ formatDateTime(d.registeredAt) }} · last sign-in {{ formatDateTime(d.lastLoginAt) }}</div>
      </div>
      <div class="actions">
        <button
          v-if="d.pinLocked && session.can(PERMISSIONS.customerLoginUnlockRequest) && !d.unlockRequests.some((r) => r.status === 'pending')"
          type="button"
          class="btn btn-primary"
          @click="dialog = 'unlock'"
        >
          Request PIN unlock
        </button>
        <button
          v-if="session.can(PERMISSIONS.customerLoginSignOut)"
          type="button"
          class="btn btn-danger"
          :disabled="d.sessions.length === 0"
          @click="dialog = 'sign-out'"
        >
          Sign out everywhere
        </button>
      </div>
    </section>
    <p v-if="done" class="notice notice--success" role="status">{{ done }}</p>

    <div class="grid">
      <section class="card">
        <div class="card-head"><h3 class="card-title">PIN</h3></div>
        <dl class="facts">
          <dt>State</dt>
          <dd>
            <StatusChip v-if="d.pinLocked" status="Locked" tone="red" small />
            <StatusChip v-else-if="d.pinSet" status="Active" small />
            <StatusChip v-else status="No PIN yet" tone="grey" small />
          </dd>
          <dt>Set</dt><dd>{{ formatDateTime(d.pinSetAt) }}</dd>
          <dt>Locked at</dt><dd>{{ formatDateTime(d.pinLockedAt) }}</dd>
          <dt>Wrong attempts</dt><dd>{{ d.failedPinAttempts }}</dd>
        </dl>
        <p v-if="d.pinLocked" class="notice pad">
          The customer can unlock it themselves with <strong>Forgotten your PIN?</strong> and an SMS code.
          Request an unlock here only when they cannot receive SMS, after verifying who they are.
        </p>
      </section>
      <section class="card">
        <div class="card-head"><h3 class="card-title">Signed in on</h3></div>
        <table class="table table--compact">
          <tbody>
            <tr v-for="s in d.sessions" :key="s.startedAt">
              <td>{{ device(s.device) }}</td>
              <td class="mono muted">{{ s.ipAddress ?? '—' }}</td>
              <td class="nowrap">since {{ formatDateTime(s.startedAt) }}</td>
            </tr>
            <tr v-if="d.sessions.length === 0"><td class="muted">Not signed in anywhere.</td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3 class="card-title">Unlock requests and history</h3></div>
      <table class="table table--compact">
        <thead><tr><th>When</th><th>What</th><th>Who</th><th>Reason or note</th></tr></thead>
        <tbody>
          <tr v-for="h in d.history" :key="h.at + h.action">
            <td class="nowrap">{{ formatDateTime(h.at) }}</td>
            <td>{{ ACTIONS[h.action] ?? h.action }}</td>
            <td>{{ h.by ?? '—' }}</td>
            <td class="muted">{{ h.reason ?? '' }}</td>
          </tr>
          <tr v-if="d.history.length === 0"><td colspan="4" class="muted">Nothing yet.</td></tr>
        </tbody>
      </table>
    </section>
  </template>

  <ReasonDialog
    :open="dialog === 'sign-out'"
    title="Sign out everywhere"
    description="Ends every session on every device. The customer signs in again with their PIN."
    confirm-label="Sign out everywhere"
    tone="danger"
    reason-placeholder="e.g. Customer reports a lost phone"
    :action="signOut"
    @close="dialog = null"
    @done="load"
  />
  <ReasonDialog
    :open="dialog === 'unlock'"
    title="Request PIN unlock"
    description="A supervisor must approve it before the PIN is unlocked."
    confirm-label="Send for approval"
    reason-label="How you verified the caller"
    reason-placeholder="e.g. Called from the registered number; NIDA number and date of birth matched"
    :action="requestUnlock"
    @close="dialog = null"
    @done="load"
  />
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
.actions {
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
.pad {
  margin: 0 24px 20px;
}
</style>

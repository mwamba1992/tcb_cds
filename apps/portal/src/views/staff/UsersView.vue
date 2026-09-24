<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usersApi, type CustomerLoginRow, type StaffRow, type UnlockRequestRow } from '../../api/live/backoffice';
import DataTable, { type Column } from '../../components/DataTable.vue';
import ReasonDialog from '../../components/ReasonDialog.vue';
import SegmentedControl from '../../components/SegmentedControl.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useTable } from '../../composables/useTable';
import { DEMO, LIVE_AUTH } from '../../config/portal';
import { ROLE_NAMES } from '../../lib/status';
import { formatDateTime } from '../../lib/time';
import { useSessionStore } from '../../stores/session';

/**
 * User accounts: staff (ICT administrators), customer sign-ins and PIN unlock
 * approvals (operations). Each tab appears only to those allowed to use it.
 */
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

type Tab = 'staff' | 'customers' | 'unlocks';
const canStaff = computed(() => session.can(PERMISSIONS.adminUserManage));
const canCustomers = computed(() => session.can(PERMISSIONS.customerLoginRead));
const canApprove = computed(() => session.can(PERMISSIONS.customerLoginUnlockApprove));
const tabs = computed(() => [
  ...(canStaff.value ? [{ value: 'staff' as Tab, label: 'Staff' }] : []),
  ...(canCustomers.value
    ? [
        { value: 'customers' as Tab, label: 'Customer logins' },
        { value: 'unlocks' as Tab, label: `Unlock requests${unlocks.total.value ? ` (${unlocks.total.value})` : ''}` },
      ]
    : []),
]);
const tab = computed<Tab>({
  get: () => {
    const asked = route.query['tab'] as Tab | undefined;
    return tabs.value.some((t) => t.value === asked) ? (asked as Tab) : (tabs.value[0]?.value ?? 'customers');
  },
  set: (next) => void router.replace({ query: { tab: next } }),
});

// ---- staff

const staff = canStaff.value
  ? useTable<StaffRow>(usersApi.staff, { sort: 'name:asc', filters: { role: '', status: '' } })
  : null;
const staffColumns: Column[] = [
  { key: 'displayName', label: 'Name', sort: 'name' },
  { key: 'role', label: 'Role', sort: 'role' },
  { key: 'status', label: 'Status' },
  { key: 'lastLoginAt', label: 'Last sign-in', sort: 'lastLogin', nowrap: true },
  { key: 'actions', label: 'Actions', hiddenLabel: true, align: 'right' },
];
const STAFF_ROLES = ['ops_officer', 'ops_supervisor', 'compliance_officer', 'treasury_officer', 'bot_observer', 'system_admin'];
const st = (r: Record<string, unknown>) => r as unknown as StaffRow;

type Dialog =
  | { kind: 'create' }
  | { kind: 'role'; user: StaffRow }
  | { kind: 'status'; user: StaffRow }
  | { kind: 'unlock'; user: StaffRow }
  | { kind: 'password'; user: StaffRow }
  | { kind: 'decide'; request: UnlockRequestRow; approve: boolean };
const dialog = ref<Dialog | null>(null);
const form = reactive({ username: '', displayName: '', role: 'ops_officer', password: '', newRole: '' });

function openCreate() {
  Object.assign(form, { username: '', displayName: '', role: 'ops_officer', password: '' });
  dialog.value = { kind: 'create' };
}
function openRole(user: StaffRow) {
  form.newRole = user.role;
  dialog.value = { kind: 'role', user };
}

const dialogProps = computed(() => {
  const d = dialog.value;
  if (!d) return null;
  switch (d.kind) {
    case 'create':
      return {
        title: 'Add a staff user',
        confirmLabel: 'Add user',
        reasonPlaceholder: 'e.g. New joiner, Operations, approved by Head of Treasury Operations',
        // Sent by runDialog, which has the reason typed in the dialog.
        action: async () => undefined,
      };
    case 'role':
      return {
        title: `Change role: ${d.user.displayName}`,
        description: 'They are signed out and sign in again with the new role.',
        confirmLabel: 'Change role',
        action: (reason: string) => usersApi.updateStaff(d.user.accountId, { role: form.newRole, reason }),
      };
    case 'status':
      return d.user.status === 'active'
        ? {
            title: `Disable ${d.user.displayName}`,
            description: 'They are signed out now and cannot sign in until enabled again.',
            confirmLabel: 'Disable user',
            tone: 'danger' as const,
            action: (reason: string) => usersApi.updateStaff(d.user.accountId, { status: 'suspended', reason }),
          }
        : {
            title: `Enable ${d.user.displayName}`,
            confirmLabel: 'Enable user',
            action: (reason: string) => usersApi.updateStaff(d.user.accountId, { status: 'active', reason }),
          };
    case 'unlock':
      return {
        title: `Unlock ${d.user.displayName}`,
        description: 'Their sign-in was locked after too many wrong passwords.',
        confirmLabel: 'Unlock',
        action: (reason: string) => usersApi.unlockStaff(d.user.accountId, reason),
      };
    case 'password':
      return {
        title: `New password for ${d.user.displayName}`,
        description: 'Development only. They are signed out everywhere.',
        confirmLabel: 'Set password',
        action: (reason: string) => usersApi.resetStaffPassword(d.user.accountId, form.password, reason),
      };
    case 'decide':
      return d.approve
        ? {
            title: 'Approve PIN unlock',
            description: `Requested by ${d.request.requestedBy}: “${d.request.reason}”. The customer can sign in with their current PIN straight away.`,
            confirmLabel: 'Approve unlock',
            tone: 'success' as const,
            reasonLabel: 'Note',
            action: (note: string) => usersApi.decideUnlock(d.request.id, 'approve', note),
          }
        : {
            title: 'Reject PIN unlock',
            description: `Requested by ${d.request.requestedBy}: “${d.request.reason}”. The PIN stays locked; the customer can reset it by SMS code.`,
            confirmLabel: 'Reject',
            tone: 'danger' as const,
            reasonLabel: 'Why',
            action: (note: string) => usersApi.decideUnlock(d.request.id, 'reject', note),
          };
    default:
      return null;
  }
});

// The create form's reason is typed into the dialog's own box, so pass it through.
async function runDialog(reason: string) {
  const d = dialog.value;
  const p = dialogProps.value;
  if (!d || !p) return;
  if (d.kind === 'create') {
    await usersApi.createStaff({
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
      reason,
    });
  } else {
    await p.action(reason);
  }
}
function afterDialog() {
  void staff?.reload();
  void unlocks.reload();
  void logins.reload();
}

// ---- customer logins and unlocks

const logins = useTable<CustomerLoginRow>(usersApi.customerLogins, { sort: 'registered:desc', filters: { locked: '' } });
const loginColumns: Column[] = [
  { key: 'phone', label: 'Mobile' },
  { key: 'state', label: 'PIN' },
  { key: 'activeSessions', label: 'Signed in on', align: 'right' },
  { key: 'lastLoginAt', label: 'Last sign-in', sort: 'lastLogin', nowrap: true },
  { key: 'registeredAt', label: 'Registered', sort: 'registered', nowrap: true },
];
const lg = (r: Record<string, unknown>) => r as unknown as CustomerLoginRow;

const unlocks = useTable<UnlockRequestRow>(usersApi.unlockRequests, { sort: 'requested:asc' });
const unlockColumns: Column[] = [
  { key: 'phone', label: 'Customer' },
  { key: 'requestedBy', label: 'Requested by' },
  { key: 'reason', label: 'How the caller was verified' },
  { key: 'requestedAt', label: 'Requested', sort: 'requested', nowrap: true },
  { key: 'actions', label: 'Actions', hiddenLabel: true, align: 'right' },
];
const ul = (r: Record<string, unknown>) => r as unknown as UnlockRequestRow;
</script>

<template>
  <section class="card">
    <div class="card-head--lg head">
      <div>
        <h2 class="card-title">User accounts</h2>
        <p class="card-sub">Every change asks for a reason and is recorded with your name.</p>
      </div>
      <SegmentedControl v-if="LIVE_AUTH && tabs.length > 1" v-model="tab" :options="tabs" label="View" />
    </div>

    <p v-if="!LIVE_AUTH" class="notice pad">Available with live sign-in.</p>

    <DataTable
      v-else-if="tab === 'staff' && staff"
      v-bind="staff.bind.value"
      :columns="staffColumns"
      row-key="accountId"
      search-placeholder="Search by name or username"
      empty="No staff match."
    >
      <template #filters>
        <select v-model="staff.filters.role" class="input input--text filter" aria-label="Role">
          <option value="">All roles</option>
          <option v-for="r in STAFF_ROLES" :key="r" :value="r">{{ ROLE_NAMES[r] }}</option>
        </select>
        <select v-model="staff.filters.status" class="input input--text filter" aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Disabled</option>
        </select>
      </template>
      <template #actions>
        <button type="button" class="btn btn--md btn-primary" @click="openCreate">Add staff user</button>
      </template>
      <template #cell-displayName="{ row: r }">
        <div class="cell-title">{{ st(r).displayName }}</div>
        <div class="cell-sub mono">{{ st(r).username }}</div>
      </template>
      <template #cell-role="{ row: r }">{{ ROLE_NAMES[st(r).role] ?? st(r).role }}</template>
      <template #cell-status="{ row: r }">
        <StatusChip :status="st(r).status === 'active' ? 'Active' : 'Disabled'" small />
        <StatusChip v-if="st(r).locked" status="Locked" small class="gap" />
      </template>
      <template #cell-lastLoginAt="{ row: r }">{{ formatDateTime(st(r).lastLoginAt) }}</template>
      <template #cell-actions="{ row: r }">
        <div v-if="st(r).accountId !== session.user.id" class="row-actions">
          <button type="button" class="btn btn--sm btn-outline" @click="openRole(st(r))">Role</button>
          <button v-if="st(r).locked" type="button" class="btn btn--sm btn-outline" @click="dialog = { kind: 'unlock', user: st(r) }">Unlock</button>
          <button v-if="DEMO" type="button" class="btn btn--sm btn-outline" @click="(form.password = ''), (dialog = { kind: 'password', user: st(r) })">Password</button>
          <button type="button" class="btn btn--sm" :class="st(r).status === 'active' ? 'btn-danger' : 'btn-outline'" @click="dialog = { kind: 'status', user: st(r) }">
            {{ st(r).status === 'active' ? 'Disable' : 'Enable' }}
          </button>
        </div>
        <span v-else class="muted small">You</span>
      </template>
    </DataTable>

    <DataTable
      v-else-if="tab === 'customers'"
      v-bind="logins.bind.value"
      :columns="loginColumns"
      row-key="accountId"
      search-placeholder="Search by mobile number"
      empty="No customer logins match."
      clickable
      @row-click="(r) => router.push({ name: 'staff-customer-login', params: { id: lg(r).accountId } })"
    >
      <template #filters>
        <select v-model="logins.filters.locked" class="input input--text filter" aria-label="PIN state">
          <option value="">All logins</option>
          <option value="true">Locked PINs only</option>
        </select>
      </template>
      <template #cell-phone="{ row: r }"><span class="mono">{{ lg(r).phone }}</span></template>
      <template #cell-state="{ row: r }">
        <StatusChip v-if="lg(r).pinLocked" :status="lg(r).unlockPending ? 'Locked · unlock pending' : 'Locked'" tone="red" small />
        <StatusChip v-else-if="lg(r).pinSet" status="Active" small />
        <StatusChip v-else status="No PIN yet" tone="grey" small />
      </template>
      <template #cell-activeSessions="{ row: r }">{{ lg(r).activeSessions }} {{ lg(r).activeSessions === 1 ? 'device' : 'devices' }}</template>
      <template #cell-lastLoginAt="{ row: r }">{{ formatDateTime(lg(r).lastLoginAt) }}</template>
      <template #cell-registeredAt="{ row: r }">{{ formatDateTime(lg(r).registeredAt) }}</template>
    </DataTable>

    <DataTable
      v-else
      v-bind="unlocks.bind.value"
      :columns="unlockColumns"
      row-key="id"
      empty="No unlocks waiting."
    >
      <template #cell-phone="{ row: r }">
        <RouterLink class="mono link-row" :to="{ name: 'staff-customer-login', params: { id: ul(r).accountId } }">{{ ul(r).phone }}</RouterLink>
      </template>
      <template #cell-reason="{ row: r }"><span class="reason">{{ ul(r).reason }}</span></template>
      <template #cell-requestedAt="{ row: r }">{{ formatDateTime(ul(r).requestedAt) }}</template>
      <template #cell-actions="{ row: r }">
        <div v-if="canApprove" class="row-actions">
          <button type="button" class="btn btn--sm btn-success" @click="dialog = { kind: 'decide', request: ul(r), approve: true }">Approve</button>
          <button type="button" class="btn btn--sm btn-danger" @click="dialog = { kind: 'decide', request: ul(r), approve: false }">Reject</button>
        </div>
        <span v-else class="muted small">Supervisor decides</span>
      </template>
    </DataTable>
  </section>

  <ReasonDialog
    v-if="dialogProps"
    :open="!!dialog"
    v-bind="dialogProps"
    :action="runDialog"
    @close="dialog = null"
    @done="afterDialog"
  >
    <template v-if="dialog?.kind === 'create'">
      <div class="two">
        <label class="field"><span class="field-label">Full name</span><input v-model="form.displayName" class="input input--text" /></label>
        <label class="field"><span class="field-label">Username</span><input v-model="form.username" class="input input--text mono" placeholder="firstname.lastname" /></label>
      </div>
      <label class="field">
        <span class="field-label">Role</span>
        <select v-model="form.role" class="input input--text">
          <option v-for="r in STAFF_ROLES" :key="r" :value="r">{{ ROLE_NAMES[r] }}</option>
        </select>
      </label>
      <label v-if="DEMO" class="field">
        <span class="field-label">Password <span class="muted">(development only)</span></span>
        <input v-model="form.password" class="input input--text" type="password" autocomplete="new-password" />
        <span class="field-hint">At least 10 characters. In production staff sign in through TCB's directory.</span>
      </label>
    </template>
    <label v-else-if="dialog?.kind === 'role'" class="field">
      <span class="field-label">New role</span>
      <select v-model="form.newRole" class="input input--text">
        <option v-for="r in STAFF_ROLES" :key="r" :value="r">{{ ROLE_NAMES[r] }}</option>
      </select>
    </label>
    <label v-else-if="dialog?.kind === 'password'" class="field">
      <span class="field-label">New password</span>
      <input v-model="form.password" class="input input--text" type="password" autocomplete="new-password" />
    </label>
  </ReasonDialog>
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
  margin: 0 24px 24px;
}
.filter {
  font-size: 14px;
  padding: 8px 10px;
}
.row-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.gap {
  margin-left: 6px;
}
.small {
  font-size: 12px;
}
.link-row {
  color: var(--navy);
}
.reason {
  display: inline-block;
  max-width: 420px;
  font-size: 13px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
</style>

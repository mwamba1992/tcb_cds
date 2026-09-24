<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { computed, ref, watch } from 'vue';
import type { KycAction, KycCase } from '../../api';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { useNow } from '../../composables/useNow';
import { riskTone } from '../../lib/status';
import { formatAge } from '../../lib/time';
import { LIVE_AUTH } from '../../config/portal';
import { useOperationsStore } from '../../stores/operations';
import { useSessionStore } from '../../stores/session';

const ops = useOperationsStore();
const session = useSessionStore();
const now = useNow(30_000);
const { pending, error, run } = useAsync();

const selectedId = ref<string | null>(null);
watch(
  () => ops.kyc,
  (cases) => {
    if (!selectedId.value && cases[0]) selectedId.value = cases[0].id;
  },
  { immediate: true },
);
const decisionNote = ref('');
watch(selectedId, () => {
  error.value = null;
  decisionNote.value = '';
});

const selected = computed(() => ops.kyc.find((k) => k.id === selectedId.value) ?? null);

const MAKER_STATES = ['New', 'Returned', 'Info requested'];

/**
 * A checker holds `kyc:decide`; a maker holds `kyc:review` only. The design lets the
 * two act on different steps, so a checker is not offered the maker's first decision.
 */
const isChecker = computed(() => session.can(PERMISSIONS.kycDecide));
const canMake = computed(
  () =>
    !!selected.value &&
    !isChecker.value &&
    session.can(PERMISSIONS.kycReview) &&
    MAKER_STATES.includes(selected.value.status),
);
const canCheck = computed(
  () =>
    !!selected.value &&
    isChecker.value &&
    selected.value.status === 'Awaiting checker' &&
    selected.value.makerId !== session.user.id,
);

const note = computed(() => {
  const k = selected.value;
  if (!k) return '';
  if (k.status === 'Approved')
    return 'Approved. A CDS account opening request has been raised for BoT CDS with the linked settlement account.';
  if (k.status === 'Rejected') return 'Rejected. The investor has been notified by SMS.';
  if (!isChecker.value && k.status === 'Awaiting checker')
    return 'Sent for approval. A different user acting as checker must approve it.';
  if (isChecker.value && k.status === 'Awaiting checker' && k.makerId === session.user.id)
    return 'You took the maker decision on this case. A different user must approve it.';
  if (isChecker.value && MAKER_STATES.includes(k.status))
    return 'A maker must review this case first.';
  return '';
});

function age(k: KycCase) {
  const elapsed = now.value - new Date(k.openedAt).getTime();
  const breach = elapsed > k.slaHours * 3_600_000;
  return { text: formatAge(elapsed) + (breach ? ' · SLA' : ''), breach };
}

function resultClass(result: string) {
  return result === 'match' ? 'ok' : result === 'mismatch' ? 'bad' : 'na';
}
const resultLabel = (result: string) =>
  result === 'match' ? 'Match' : result === 'mismatch' ? 'Mismatch' : 'n/a';

async function act(action: KycAction) {
  if (!selected.value) return;
  const id = selected.value.id;
  const note = decisionNote.value.trim() || undefined;
  const done = await run(async () => {
    await ops.actOnKyc(id, action, note);
    return true;
  });
  if (done) decisionNote.value = '';
}
</script>

<template>
  <div class="row">
    <section class="card queue" aria-labelledby="queue-title">
      <div class="card-head queue-head">
        <h2 id="queue-title" class="queue-title">Exception queue</h2>
        <span class="muted small">Low-risk retail cases go straight through</span>
      </div>
      <div role="listbox" aria-labelledby="queue-title">
        <button
          v-for="k in ops.kyc"
          :key="k.id"
          type="button"
          role="option"
          :aria-selected="k.id === selectedId"
          class="case"
          :class="{ 'case--selected': k.id === selectedId }"
          @click="selectedId = k.id"
        >
          <div class="case-top">
            <span class="case-name">{{ k.name }}</span>
            <span class="mono case-age" :class="{ 'case-age--breach': age(k).breach }">{{
              age(k).text
            }}</span>
          </div>
          <div class="case-reason muted">{{ k.reason }}</div>
          <div class="case-chips">
            <StatusChip :status="`${k.risk} risk`" :tone="riskTone(k.risk)" small />
            <StatusChip :status="k.status" small />
          </div>
        </button>
      </div>
    </section>

    <section v-if="selected" class="card detail" aria-labelledby="case-title">
      <div class="card-head--lg detail-head">
        <div>
          <h2 id="case-title" class="card-title">{{ selected.name }}</h2>
          <div class="card-sub">
            <span class="mono">{{ selected.id }}</span> · {{ selected.type }} · via
            {{ selected.channel }}
          </div>
        </div>
        <StatusChip :status="selected.status" class="detail-status" />
      </div>
      <div class="detail-body">
        <p v-if="(selected.reasons?.length ?? 0) <= 1" class="exception">
          <strong>Exception:</strong> {{ selected.reason }}
        </p>
        <div v-else class="exception">
          <strong>Exceptions:</strong>
          <ul class="reasons">
            <li v-for="r in selected.reasons" :key="r">{{ r }}</li>
          </ul>
        </div>

        <div class="compare scroll-x">
          <table class="table table--compact">
            <thead>
              <tr>
                <th>Field</th>
                <th>{{ selected.sourceA }}</th>
                <th>{{ selected.sourceB }}</th>
                <th><span class="visually-hidden">Result</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in selected.fields" :key="f.label">
                <td class="muted">{{ f.label }}</td>
                <td class="mono value">{{ f.a }}</td>
                <td class="mono value">{{ f.b }}</td>
                <td class="result" :class="`result--${resultClass(f.result)}`">
                  {{ resultLabel(f.result) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="screening">
          <h3 class="field-label">Screening</h3>
          <div v-for="s in selected.screening" :key="s.label" class="screen-row">
            <span>{{ s.label }}</span>
            <span class="screen-result" :class="s.ok ? 'result--ok' : 'result--bad'">{{
              s.result
            }}</span>
          </div>
        </div>

        <div v-if="selected.makerName || selected.checkerName" class="trail">
          <h3 class="field-label">Decisions</h3>
          <p v-if="selected.makerName" class="trail-row">
            <span class="muted">Maker</span> {{ selected.makerName
            }}<template v-if="selected.makerNote">: “{{ selected.makerNote }}”</template>
          </p>
          <p v-if="selected.checkerName" class="trail-row">
            <span class="muted">Checker</span> {{ selected.checkerName
            }}<template v-if="selected.checkerNote">: “{{ selected.checkerNote }}”</template>
          </p>
        </div>

        <label v-if="LIVE_AUTH && (canMake || canCheck)" class="field">
          <span class="field-label">Note <span class="muted">(recorded with your decision)</span></span>
          <textarea v-model="decisionNote" class="input input--text note" rows="2" maxlength="500" />
        </label>

        <div v-if="canMake" class="actions">
          <button type="button" class="btn btn-primary" :disabled="pending" @click="act('approve')">
            Approve, send to checker
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="pending"
            @click="act('request-info')"
          >
            Request information
          </button>
          <button type="button" class="btn btn-danger" :disabled="pending" @click="act('reject')">
            Reject
          </button>
        </div>
        <div v-if="canCheck" class="actions">
          <button
            type="button"
            class="btn btn-success"
            :disabled="pending"
            @click="act('final-approve')"
          >
            Approve and open CDS request
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="pending"
            @click="act('return')"
          >
            Return to maker
          </button>
        </div>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <p v-else-if="note" class="notice">{{ note }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.queue {
  flex: 1 1 360px;
}
.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.queue-title {
  font-weight: 600;
  font-size: 15px;
}
.small {
  font-size: 13px;
  font-weight: 400;
}
.case {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid var(--divider);
  border-left: 3px solid transparent;
  padding: 14px 20px 14px 17px;
  cursor: pointer;
  color: var(--ink);
  background: #fff;
}
.case:hover {
  background: var(--row-hover);
}
.case--selected,
.case--selected:hover {
  background: var(--selected);
  border-left-color: var(--navy);
}
.case-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.case-name {
  font-size: 14px;
  font-weight: 600;
}
.case-age {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.case-age--breach {
  color: var(--red-fg);
}
.case-reason {
  font-size: 13px;
}
.case-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.detail {
  flex: 1.4 1 460px;
}
.detail-head {
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.detail-status {
  align-self: flex-start;
}
.detail-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.exception {
  font-size: 14px;
  margin: 0;
  text-wrap: pretty;
}
.compare {
  border: 1px solid var(--border);
  border-radius: 8px;
}
.value {
  font-size: 13px;
}
.result {
  font-size: 12px;
  font-weight: 600;
}
.result--ok {
  color: var(--green-fg);
}
.result--bad {
  color: var(--red-fg);
}
.result--na {
  color: var(--muted);
}
.screening {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.screen-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
}
.screen-result {
  font-weight: 500;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.notice {
  margin: 0;
}
.reasons {
  margin: 6px 0 0;
  padding-left: 18px;
}
.trail {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.trail-row {
  margin: 0;
  font-size: 14px;
}
.trail-row .muted {
  display: inline-block;
  width: 64px;
}
.note {
  resize: vertical;
  font-family: inherit;
}
</style>

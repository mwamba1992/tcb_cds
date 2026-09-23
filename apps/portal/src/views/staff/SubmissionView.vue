<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { computed, ref } from 'vue';
import type { Batch, BatchStage } from '../../api';
import { useAsync } from '../../composables/useAsync';
import { useNow } from '../../composables/useNow';
import { formatAmount, formatCompact } from '../../lib/money';
import { formatCountdown, formatTime } from '../../lib/time';
import { useOperationsStore } from '../../stores/operations';
import { useSessionStore } from '../../stores/session';

const ops = useOperationsStore();
const session = useSessionStore();
const now = useNow();
const { pending, error, run } = useAsync();
const acting = ref<string | null>(null);

const STAGES: BatchStage[] = [
  'Awaiting consolidation',
  'Awaiting maker',
  'Awaiting checker',
  'Submitting',
  'Acknowledged by BoT',
];
const STEP_LABELS = [
  'Consolidated',
  'Prepared by maker',
  'Checker approval',
  'Submitted to BoT',
  'BoT acknowledgement',
];

function steps(b: Batch) {
  const stage = STAGES.indexOf(b.stage);
  const meta = [
    `Today ${formatTime(b.consolidatedAt)} · system`,
    b.preparedBy ? `${b.preparedBy.name} · ${formatTime(b.preparedBy.at)}` : 'Pending',
    b.approvedBy ? `${b.approvedBy.name} · approved` : 'Pending',
    b.batchReference ? `POST /bids · ${b.batchReference}` : 'Pending',
    b.acknowledgedAt ? `Acknowledged ${formatTime(b.acknowledgedAt)}` : 'Pending',
  ];
  return STEP_LABELS.map((label, i) => ({
    label,
    meta: meta[i],
    done: i < stage || (i === 4 && stage === 4),
    current: i === stage && stage !== 4,
    last: i === 4,
  }));
}

function action(b: Batch): { label: string; run: () => Promise<void> } | null {
  if (b.stage === 'Awaiting maker' && session.can(PERMISSIONS.batchPrepare)) {
    return { label: 'Prepare submission', run: () => ops.prepareBatch(b.id) };
  }
  if (
    b.stage === 'Awaiting checker' &&
    session.can(PERMISSIONS.batchApprove) &&
    b.preparedBy?.id !== session.user.id
  ) {
    return { label: 'Approve and submit to BoT', run: () => ops.approveBatch(b.id) };
  }
  return null;
}

function note(b: Batch): string {
  switch (b.stage) {
    case 'Awaiting consolidation':
      return 'Bids are consolidated automatically at 09:00 on auction day.';
    case 'Awaiting maker':
      return session.can(PERMISSIONS.batchPrepare)
        ? 'Review the consolidated file and send it for approval.'
        : 'Waiting for a maker to prepare this batch.';
    case 'Awaiting checker':
      if (b.preparedBy?.id === session.user.id)
        return 'Prepared by you. A different user must approve it.';
      return session.can(PERMISSIONS.batchApprove)
        ? `Prepared by ${b.preparedBy?.name} at ${formatTime(b.preparedBy?.at ?? '')}. Approving submits the batch to the BoT Auction API.`
        : 'Waiting for a checker to approve this batch.';
    case 'Submitting':
      return 'Submitting to BoT…';
    default:
      return `Submitted and acknowledged. Results will arrive by BoT callback and be confirmed with GET /winners/${b.isin}.`;
  }
}

const batches = computed(() =>
  ops.batches.map((b) => ({
    ...b,
    steps: steps(b),
    action: action(b),
    note: note(b),
    countdown: formatCountdown(new Date(b.cutoffAt).getTime() - now.value),
    stats: [
      { label: 'Bids', value: b.bids.toLocaleString('en-US') },
      { label: 'Competitive', value: b.competitive.toLocaleString('en-US') },
      { label: 'Non-competitive', value: b.nonCompetitive.toLocaleString('en-US') },
      {
        label: 'Face value (TZS)',
        value: formatCompact(b.faceValue),
        title: formatAmount(b.faceValue),
      },
      {
        label: 'Funds held (TZS)',
        value: formatCompact(b.fundsHeld),
        title: formatAmount(b.fundsHeld),
      },
    ],
  })),
);

async function perform(b: { id: string; action: { run: () => Promise<void> } | null }) {
  if (!b.action) return;
  acting.value = b.id;
  await run(b.action.run);
  acting.value = null;
}
</script>

<template>
  <p class="lead">
    Bids are consolidated per ISIN at 09:00 on auction day. A maker prepares the batch, a different
    checker approves it, and the platform submits it to the BoT Auction API and stores the
    acknowledgement.
  </p>
  <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

  <section v-for="b in batches" :key="b.id" class="card" :aria-labelledby="`batch-${b.id}`">
    <div class="card-head--lg batch-head">
      <div>
        <h2 :id="`batch-${b.id}`" class="card-title">{{ b.name }}</h2>
        <div class="card-sub">
          <span class="mono">{{ b.isin }}</span> ·
          {{ b.batchReference ? `Batch ${b.batchReference}` : `Batch ${b.id}` }}
        </div>
      </div>
      <div class="cutoff">
        <div class="muted cutoff-label">Cut-off in</div>
        <div class="countdown cutoff-value">{{ b.countdown }}</div>
      </div>
    </div>

    <div class="stats">
      <div v-for="s in b.stats" :key="s.label">
        <div class="muted stat-label">{{ s.label }}</div>
        <div class="stat-value num" :title="s.title">{{ s.value }}</div>
      </div>
    </div>

    <ol class="pipeline" aria-label="Submission progress">
      <li
        v-for="(s, i) in b.steps"
        :key="s.label"
        class="stage"
        :class="{ 'stage--done': s.done, 'stage--current': s.current }"
      >
        <div class="stage-track">
          <span class="stage-dot">{{ s.done ? '✓' : i + 1 }}</span>
          <span v-if="!s.last" class="stage-line"></span>
        </div>
        <div class="stage-label">{{ s.label }}</div>
        <div class="stage-meta muted">{{ s.meta }}</div>
      </li>
    </ol>

    <div class="batch-foot">
      <span class="muted foot-note">{{ b.note }}</span>
      <button
        v-if="b.action"
        type="button"
        class="btn btn-primary"
        :disabled="pending && acting === b.id"
        @click="perform(b)"
      >
        {{ b.action.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.batch-head {
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.cutoff {
  text-align: right;
}
.cutoff-label {
  font-size: 12px;
}
.cutoff-value {
  font-size: 16px;
  font-weight: 600;
}
.stats {
  padding: 18px 24px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  border-bottom: 1px solid var(--border);
}
.stat-label {
  font-size: 12px;
}
.stat-value {
  font-size: 17px;
  font-weight: 600;
  margin-top: 4px;
}
.pipeline {
  padding: 20px 24px;
  display: flex;
  overflow-x: auto;
  list-style: none;
  margin: 0;
}
.stage {
  flex: 1 1 0;
  min-width: 120px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 12px;
}
.stage-track {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stage-dot {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--border);
  color: var(--muted);
}
.stage--current .stage-dot {
  background: var(--navy);
  color: #fff;
}
.stage--done .stage-dot {
  background: var(--green-fg);
  color: #fff;
}
.stage-line {
  flex: 1;
  height: 2px;
  background: var(--border);
}
.stage--done .stage-line {
  background: var(--green-fg);
}
.stage-label {
  font-size: 13px;
  font-weight: 600;
}
.stage--current .stage-label {
  color: var(--navy);
}
.stage-meta {
  font-size: 12px;
  word-break: break-word;
}
.batch-foot {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: var(--row-hover);
  border-radius: 0 0 10px 10px;
}
.foot-note {
  font-size: 13px;
  text-wrap: pretty;
}
</style>

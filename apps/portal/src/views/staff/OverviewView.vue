<script setup lang="ts">
import { PERMISSIONS } from '@govsec/auth/roles';
import { computed } from 'vue';
import KpiCard from '../../components/KpiCard.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useNow } from '../../composables/useNow';
import { formatAmount, formatCompact } from '../../lib/money';
import {
  formatAuctionDate,
  formatCountdown,
  formatCutoff,
  formatDate,
  formatTime,
} from '../../lib/time';
import { useOperationsStore } from '../../stores/operations';
import { useSessionStore } from '../../stores/session';

const ops = useOperationsStore();
const session = useSessionStore();
const now = useNow();

const o = computed(() => ops.overview);

const openKyc = computed(() =>
  ops.kyc.filter((k) =>
    ['New', 'Returned', 'Awaiting checker', 'Info requested'].includes(k.status),
  ),
);
const pastSla = computed(
  () =>
    openKyc.value.filter((k) => now.value - new Date(k.openedAt).getTime() > k.slaHours * 3_600_000)
      .length,
);
const breaks = computed(() => ops.recon?.rows.filter((r) => r.result === 'Break').length ?? 0);
const reconLabel = computed(() =>
  ops.recon
    ? `Auction ${formatAuctionDate(ops.recon.auctionDate).slice(4, -5)} · value date ${formatAuctionDate(ops.recon.valueDate).slice(4, -5)}`
    : '',
);

const control = computed(() =>
  (o.value?.control ?? []).map((row) => ({
    ...row,
    countdown: formatCountdown(new Date(row.cutoffAt).getTime() - now.value),
  })),
);

const channelMax = computed(() => Math.max(1, ...(o.value?.channels.map((c) => c.bids) ?? [1])));
const channelTotal = computed(() => o.value?.channels.reduce((t, c) => t + c.bids, 0) ?? 0);

const attention = computed(() => {
  const items: { title: string; note: string; to: string }[] = [];
  const awaiting = ops.batches.filter(
    (b) => b.stage === 'Awaiting maker' || b.stage === 'Awaiting checker',
  );
  if (awaiting.length && o.value) {
    items.push({
      title: 'Batches awaiting approval',
      note: `Submission window closes at ${formatTime(o.value.submissionWindowClosesAt)} for ${formatAuctionDate(awaiting[0]?.cutoffAt ?? '').slice(0, -5)} auctions`,
      to: 'staff-submission',
    });
  }
  if (openKyc.value.length && session.can(PERMISSIONS.kycReview)) {
    items.push({
      title: `${openKyc.value.length} KYC exceptions open`,
      note: pastSla.value ? 'PEP and corporate cases past the 24h SLA' : 'All within SLA',
      to: 'staff-kyc',
    });
  }
  if (breaks.value && ops.recon && session.can(PERMISSIONS.settlementRead)) {
    items.push({
      title: `${breaks.value} reconciliation breaks`,
      note: `${ops.recon.auctionName.replace('Treasury Bill', 'T-Bill')} settled ${formatDate(ops.recon.valueDate).slice(0, 6)}`,
      to: 'staff-recon',
    });
  }
  return items;
});
</script>

<template>
  <template v-if="o">
    <div class="kpi-grid">
      <KpiCard
        label="Bids, open auctions"
        :value="o.bidsOpen.toLocaleString('en-US')"
        :note="`Up ${o.bidsSinceOpen} since 08:00`"
      />
      <KpiCard
        label="Face value bid"
        :value="`TZS ${formatCompact(o.faceValueBid)}`"
        note="Funds held in full"
      />
      <KpiCard
        label="KYC exceptions"
        :value="String(openKyc.length)"
        :note="pastSla ? `${pastSla} past SLA` : 'All within SLA'"
        :tone="pastSla ? 'bad' : 'muted'"
      />
      <KpiCard
        label="Reconciliation breaks"
        :value="String(breaks)"
        :note="breaks ? reconLabel : 'All cleared'"
        :tone="breaks ? 'bad' : 'good'"
      />
    </div>

    <section class="card scroll-x" aria-labelledby="control-title">
      <h2 id="control-title" class="card-head">Auction control</h2>
      <table class="table control">
        <thead>
          <tr>
            <th>Auction</th>
            <th>Cut-off</th>
            <th class="right">Bids</th>
            <th class="right">Face value (TZS)</th>
            <th>Submission</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in control" :key="r.auctionId">
            <td>
              <div class="cell-title">{{ r.name }}</div>
              <div class="cell-sub mono">{{ r.isin }}</div>
            </td>
            <td class="nowrap">
              <div>{{ formatCutoff(r.cutoffAt) }}</div>
              <div class="cell-sub countdown">{{ r.countdown }}</div>
            </td>
            <td class="right num">{{ r.bids.toLocaleString('en-US') }}</td>
            <td class="right num">{{ formatAmount(r.faceValue) }}</td>
            <td>
              <RouterLink :to="{ name: 'staff-submission' }" class="chip-link">
                <StatusChip :status="r.stage" />
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="row">
      <section class="card attention" aria-labelledby="attention-title">
        <h2 id="attention-title" class="card-head">Needs attention</h2>
        <RouterLink
          v-for="t in attention"
          :key="t.title"
          :to="{ name: t.to }"
          class="attention-item"
        >
          <div>
            <div class="attention-title">{{ t.title }}</div>
            <div class="attention-note muted">{{ t.note }}</div>
          </div>
          <span class="open">Open</span>
        </RouterLink>
        <p v-if="attention.length === 0" class="muted nothing">Nothing needs your attention.</p>
      </section>

      <section class="card channels" aria-labelledby="channels-title">
        <h2 id="channels-title" class="card-head">Bids by channel · open auctions</h2>
        <div class="channels-body">
          <div v-for="c in o.channels" :key="c.channel" class="channel">
            <span>{{ c.channel }}</span>
            <div
              class="bar"
              role="img"
              :aria-label="`${c.channel} ${Math.round((c.bids / channelTotal) * 100)}%`"
            >
              <div class="bar-fill" :style="{ width: `${(c.bids / channelMax) * 100}%` }"></div>
            </div>
            <span class="mono pct">{{ Math.round((c.bids / channelTotal) * 100) }}%</span>
          </div>
        </div>
      </section>
    </div>
  </template>
  <p v-else class="muted" role="status">Loading overview…</p>
</template>

<style scoped>
.control {
  min-width: 700px;
}
.chip-link {
  text-decoration: none;
}
.attention,
.channels {
  flex: 1 1 360px;
  overflow: hidden;
}
.attention-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--divider);
  color: var(--ink);
  text-decoration: none;
}
.attention-item:hover {
  background: var(--row-hover);
}
.attention-title {
  font-size: 14px;
  font-weight: 500;
}
.attention-note {
  font-size: 13px;
  margin-top: 2px;
}
.open {
  font-size: 13px;
  color: var(--navy);
  font-weight: 500;
  white-space: nowrap;
}
.nothing {
  padding: 14px 20px;
  margin: 0;
  font-size: 14px;
}
.channels-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.channel {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.bar {
  height: 8px;
  background: var(--divider);
  border-radius: 4px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--navy);
}
.pct {
  text-align: right;
}
</style>

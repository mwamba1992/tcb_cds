<script setup lang="ts">
import Big from 'big.js';
import { computed } from 'vue';
import BrandBars from '../../components/BrandBars.vue';
import KpiCard from '../../components/KpiCard.vue';
import { useNow } from '../../composables/useNow';
import { formatAmount, formatCompact, formatTzs, sum } from '../../lib/money';
import { formatAuctionDate, formatCountdown, formatDate, formatLongDate } from '../../lib/time';
import { useInvestorStore } from '../../stores/investor';

const store = useInvestorStore();
const now = useNow();

const s = computed(() => store.summary);
const holdingsFace = computed(() => sum(store.holdings.map((h) => h.faceValue)));
const nextPayment = computed(() => store.cashflows[0] ?? null);

/** The open auction closing soonest is the one worth a banner. */
const featured = computed(
  () =>
    store.auctions
      .filter((a) => a.status === 'Open')
      .sort((a, b) => a.cutoffAt.localeCompare(b.cutoffAt))[0] ?? null,
);
const featuredCountdown = computed(() =>
  featured.value ? formatCountdown(new Date(featured.value.cutoffAt).getTime() - now.value) : '',
);

const mix = computed(() => {
  const bills = sum(store.holdings.filter((h) => h.kind === 'bill').map((h) => h.faceValue));
  const bonds = sum(store.holdings.filter((h) => h.kind === 'bond').map((h) => h.faceValue));
  const total = new Big(holdingsFace.value);
  const pct = (part: string) =>
    total.eq(0) ? 0 : Number(new Big(part).div(total).times(100).round(0).toFixed(0));
  return { bills, bonds, billsPct: pct(bills), bondsPct: pct(bonds) };
});

const onHoldNote = computed(() => {
  const n = s.value?.openBidCount ?? 0;
  return `${n} open bid${n === 1 ? '' : 's'}, incl. commission`;
});
</script>

<template>
  <template v-if="s">
    <div class="welcome">
      <div>
        <div class="today muted">{{ formatLongDate(new Date(now)) }}</div>
        <div class="greeting">Habari, {{ s.firstName }}</div>
        <div class="accounts muted">
          CDS account <span class="mono ink">{{ s.cdsAccount }}</span> · Settlement account
          <span class="mono ink">{{ s.settlementAccount.masked }}</span>
        </div>
      </div>
      <RouterLink :to="{ name: 'investor-auctions' }" class="btn btn-primary"
        >View open auctions</RouterLink
      >
    </div>

    <div class="kpi-grid">
      <KpiCard
        label="Holdings, face value"
        :value="formatTzs(holdingsFace)"
        :note="`${store.holdings.length} securities in CDS`"
      />
      <KpiCard
        label="Available balance"
        :value="formatTzs(s.availableBalance)"
        :note="`${s.settlementAccount.label} · ${s.settlementAccount.masked}`"
      />
      <KpiCard
        label="Funds on hold for bids"
        :value="formatTzs(s.fundsOnHold)"
        :note="onHoldNote"
      />
      <KpiCard
        v-if="nextPayment"
        label="Next payment"
        :value="formatTzs(nextPayment.amount)"
        :note="`${nextPayment.kind} · ${formatDate(nextPayment.date)}`"
      />
    </div>

    <div v-if="featured" class="banner">
      <BrandBars variant="edge" />
      <div>
        <div class="banner-kicker">
          Open auction · {{ formatAuctionDate(featured.auctionDate) }}
        </div>
        <div class="banner-title">
          {{ featured.name }} <span class="banner-isin">{{ featured.isin }}</span>
        </div>
      </div>
      <div class="banner-right">
        <div>
          <div class="banner-kicker banner-kicker--sm">Bids close in</div>
          <div class="banner-countdown num" aria-live="off">{{ featuredCountdown }}</div>
        </div>
        <RouterLink
          :to="{ name: 'investor-bid', params: { auctionId: featured.id } }"
          class="btn btn-accent"
        >
          Place bid
        </RouterLink>
      </div>
    </div>

    <div class="row">
      <section class="card scroll-x holdings" aria-labelledby="holdings-title">
        <div class="holdings-head">
          <div class="holdings-top">
            <h2 id="holdings-title" class="section-title">Holdings</h2>
            <span class="muted small">
              Weighted yield <span class="ink strong num">{{ s.weightedYield }}%</span>
            </span>
          </div>
          <div
            class="mix-bar"
            role="img"
            :aria-label="`Treasury Bills ${mix.billsPct}%, Treasury Bonds ${mix.bondsPct}%`"
          >
            <div class="mix-bills" :style="{ flex: mix.billsPct }"></div>
            <div class="mix-bonds" :style="{ flex: mix.bondsPct }"></div>
          </div>
          <div class="mix-legend muted">
            <span
              ><span class="swatch swatch--bills"></span>Treasury Bills ·
              <span class="ink num">TZS {{ formatCompact(mix.bills) }}</span> ·
              {{ mix.billsPct }}%</span
            >
            <span
              ><span class="swatch swatch--bonds"></span>Treasury Bonds ·
              <span class="ink num">TZS {{ formatCompact(mix.bonds) }}</span> ·
              {{ mix.bondsPct }}%</span
            >
          </div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Security</th>
              <th class="right">Face value (TZS)</th>
              <th class="right">Yield</th>
              <th>Maturity</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in store.holdings" :key="h.isin">
              <td>
                <div class="cell-title">{{ h.name }}</div>
                <div class="cell-sub mono">{{ h.isin }}</div>
              </td>
              <td class="right num">{{ formatAmount(h.faceValue) }}</td>
              <td class="right num">{{ h.yield }}%</td>
              <td>{{ formatDate(h.maturityDate) }}</td>
            </tr>
            <tr v-if="store.holdings.length === 0">
              <td colspan="4" class="empty-row muted">
                No securities yet. Allotted bids appear here once they settle into your CDS account.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card payments" aria-labelledby="payments-title">
        <h2 id="payments-title" class="card-head">Upcoming payments</h2>
        <p v-if="store.cashflows.length === 0" class="empty-row muted">
          Interest and maturity payments will be listed here.
        </p>
        <div v-for="c in store.cashflows" :key="`${c.kind}-${c.date}`" class="payment">
          <div>
            <div class="payment-kind">{{ c.kind }}</div>
            <div class="payment-what muted">{{ c.security }}</div>
          </div>
          <div class="payment-right">
            <div class="payment-amount num">{{ formatTzs(c.amount) }}</div>
            <div class="payment-date muted">{{ formatDate(c.date) }}</div>
          </div>
        </div>
        <div class="payments-note muted">
          Coupon amounts shown net of {{ s.couponTaxRate }}% withholding tax.
        </div>
      </section>
    </div>
  </template>
  <p v-else class="muted" role="status">Loading your portfolio…</p>
</template>

<style scoped>
.welcome {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}
.today {
  font-size: 13px;
  margin-bottom: 6px;
}
.greeting {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.accounts {
  font-size: 14px;
  margin-top: 6px;
}
.ink {
  color: var(--ink);
}
.strong {
  font-weight: 600;
}
.small {
  font-size: 13px;
}
.btn {
  text-decoration: none;
  display: inline-block;
}

.banner {
  background: var(--navy);
  color: #fff;
  border-radius: var(--radius-card);
  padding: 22px 28px 22px 34px;
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.banner-kicker {
  font-size: 13px;
  color: var(--on-navy-muted);
}
.banner-kicker--sm {
  font-size: 12px;
}
.banner-title {
  font-size: 18px;
  font-weight: 600;
  margin-top: 4px;
}
.banner-isin {
  font-weight: 400;
  font-size: 14px;
  color: var(--on-navy-muted);
  margin-left: 6px;
}
.banner-right {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.banner-countdown {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.holdings {
  flex: 2 1 560px;
}
.holdings-head {
  padding: 16px 20px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.holdings-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.section-title {
  font-weight: 600;
  font-size: 15px;
}
.mix-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  gap: 2px;
}
.mix-bills {
  background: var(--navy);
}
.mix-bonds {
  background: var(--brand-yellow);
}
.mix-legend {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 13px;
}
.mix-legend > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.swatch--bills {
  background: var(--navy);
}
.swatch--bonds {
  background: var(--brand-yellow);
}

.payments {
  flex: 1 1 300px;
}
.payment {
  padding: 14px 20px;
  border-bottom: 1px solid var(--divider);
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.payment-kind {
  font-size: 14px;
  font-weight: 500;
}
.payment-what,
.payment-date {
  font-size: 13px;
  margin-top: 2px;
}
.payment-right {
  text-align: right;
}
.payment-amount {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.payments-note {
  padding: 12px 20px;
  font-size: 12px;
}
.empty-row {
  padding: 20px;
  font-size: 13px;
  text-align: center;
  margin: 0;
}
</style>

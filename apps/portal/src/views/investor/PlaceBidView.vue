<script setup lang="ts">
import Big from 'big.js';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Bid, BidType } from '../../api';
import SegmentedControl from '../../components/SegmentedControl.vue';
import StatusChip from '../../components/StatusChip.vue';
import { useAsync } from '../../composables/useAsync';
import { useNow } from '../../composables/useNow';
import { DEMO, LIVE_AUTH } from '../../config/portal';
import {
  amountProblem,
  commission,
  digitsOnly,
  fundsHold,
  groupDigits,
  indicativeYield,
  isValidPrice,
  settlementEstimate,
} from '../../lib/bid-math';
import { formatTzs, subtract } from '../../lib/money';
import { formatAuctionDate, formatCountdown, formatCutoff } from '../../lib/time';
import { useInvestorStore } from '../../stores/investor';

const props = defineProps<{ auctionId: string }>();
const store = useInvestorStore();
const router = useRouter();
const now = useNow();
const { pending, error, run } = useAsync();

const auction = computed(() => store.auction(props.auctionId));
const step = ref<1 | 2 | 3>(1);
const bidType = ref<BidType>('Competitive');
const amount = ref('10000000');
const price = ref('');
const pin = ref('');
const placed = ref<Bid | null>(null);

watch(
  auction,
  (a) => {
    if (a && !price.value) price.value = a.indicativePrice;
  },
  { immediate: true },
);

const competitive = computed(() => bidType.value === 'Competitive');
const typeOptions = [
  { value: 'Competitive' as BidType, label: 'Competitive' },
  { value: 'Non-competitive' as BidType, label: 'Non-competitive' },
];

const countdown = computed(() =>
  auction.value ? formatCountdown(new Date(auction.value.cutoffAt).getTime() - now.value) : '',
);
const closed = computed(() => countdown.value === 'Closed');

const amountDisplay = computed({
  get: () => groupDigits(amount.value),
  set: (typed: string) => {
    amount.value = digitsOnly(typed);
  },
});
function onPrice(event: Event) {
  price.value = (event.target as HTMLInputElement).value.replace(/[^0-9.]/g, '');
}
function onPin(event: Event) {
  pin.value = (event.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 4);
}

const problem = computed(() =>
  auction.value ? amountProblem(amount.value, auction.value.rules) : 'empty',
);
const amountValid = computed(() => problem.value === null);
const priceValid = computed(() => !competitive.value || isValidPrice(price.value));
const yieldPct = computed(() =>
  auction.value && competitive.value
    ? indicativeYield(price.value, auction.value.instrument)
    : null,
);

const fee = computed(() =>
  auction.value && amountValid.value ? commission(amount.value, auction.value.rules) : '0.00',
);
const hold = computed(() =>
  auction.value && amountValid.value
    ? fundsHold(amount.value, auction.value.rules, competitive.value && priceValid.value ? price.value : null)
    : '0.00',
);
const available = computed(() => store.summary?.availableBalance ?? '0.00');
const insufficient = computed(() => amountValid.value && new Big(hold.value).gt(available.value));
const canReview = computed(
  () => amountValid.value && priceValid.value && !insufficient.value && !closed.value,
);

const amountHint = computed(() => {
  if (!auction.value) return '';
  const base = `Minimum ${formatTzs(auction.value.rules.minimumBid)}, in multiples of ${formatTzs(auction.value.rules.bidMultiple)}.`;
  return base;
});
const amountHintIsError = computed(
  () =>
    amount.value !== '' && (problem.value === 'below-minimum' || problem.value === 'not-multiple'),
);

const bidTypeHelp = computed(() =>
  competitive.value
    ? 'You set the price. If it is below the BoT cut-off price, the bid is unsuccessful and funds are released.'
    : 'You accept the weighted average price set at the auction. Allotment is subject to the BoT non-competitive limit.',
);

const summaryRows = computed(() => {
  const faceOk = amountValid.value;
  const priceShown = competitive.value
    ? isValidPrice(price.value)
      ? new Big(price.value).toFixed(2)
      : '—'
    : 'Weighted average';
  const rows = [
    { label: 'Face value', value: faceOk ? formatTzs(amount.value) : '—' },
    { label: 'Bid type', value: bidType.value },
    { label: 'Price per 100', value: priceShown },
    { label: 'Equivalent yield', value: yieldPct.value ? `${yieldPct.value}%` : '—' },
    {
      label: 'Est. settlement amount',
      value:
        competitive.value && faceOk && isValidPrice(price.value)
          ? formatTzs(settlementEstimate(amount.value, price.value))
          : competitive.value
            ? '—'
            : 'Set at auction',
    },
    {
      label: `Commission (${auction.value ? (auction.value.rules.commissionBps / 100).toFixed(2) : '0.10'}%)`,
      value: formatTzs(fee.value),
    },
    { label: 'Funds held now', value: formatTzs(hold.value), strong: true },
    { label: 'Available after hold', value: formatTzs(subtract(available.value, hold.value)) },
  ];
  return rows;
});

const steps = computed(() =>
  ['Bid details', 'Confirm', 'Receipt'].map((label, index) => {
    const n = index + 1;
    return { n, label, done: n < step.value, current: n === step.value };
  }),
);

function review() {
  if (!canReview.value) return;
  pin.value = '';
  error.value = null;
  step.value = 2;
}

async function confirm() {
  if (!auction.value || pin.value.length !== 4) return;
  const bid = await run(() =>
    store.placeBid({
      auctionId: auction.value?.id ?? '',
      type: bidType.value,
      faceValue: amount.value,
      price: competitive.value ? price.value : null,
      pin: pin.value,
    }),
  );
  pin.value = '';
  if (bid) {
    placed.value = bid;
    step.value = 3;
  }
}
</script>

<template>
  <p v-if="!store.loaded" class="muted" role="status">Loading auction…</p>
  <div v-else-if="!auction" class="card empty">
    <p>This auction is not available.</p>
    <RouterLink :to="{ name: 'investor-auctions' }">Back to auctions</RouterLink>
  </div>
  <template v-else>
    <ol class="steps" aria-label="Progress">
      <li
        v-for="s in steps"
        :key="s.n"
        class="step"
        :class="{ 'step--current': s.current, 'step--done': s.done }"
        :aria-current="s.current ? 'step' : undefined"
      >
        <span class="step-dot">{{ s.done ? '✓' : s.n }}</span>
        <span class="step-label">{{ s.label }}</span>
      </li>
    </ol>

    <div class="row">
      <section class="card form-card">
        <div class="card-head--lg form-head">
          <div>
            <h2 class="card-title">{{ auction.name }}</h2>
            <div class="card-sub">
              <span class="mono">{{ auction.isin }}</span> · Auction
              {{ formatAuctionDate(auction.auctionDate) }}
            </div>
          </div>
          <div class="closes">
            <div class="closes-label muted">Bids close in</div>
            <div class="closes-value countdown">{{ countdown }}</div>
          </div>
        </div>

        <!-- step 1: details -->
        <form v-if="step === 1" class="form" @submit.prevent="review">
          <div class="field">
            <span id="bid-type-label" class="field-label">Bid type</span>
            <SegmentedControl v-model="bidType" :options="typeOptions" label="Bid type" size="md" />
            <div class="field-hint pretty">{{ bidTypeHelp }}</div>
          </div>

          <label class="field">
            <span class="field-label">Amount, face value (TZS)</span>
            <input
              v-model="amountDisplay"
              class="input amount-input"
              inputmode="numeric"
              autocomplete="off"
            />
            <span class="field-hint" :class="{ 'field-hint--error': amountHintIsError }">{{
              amountHint
            }}</span>
          </label>

          <label v-if="competitive" class="field">
            <span class="field-label">Price per 100 face value</span>
            <input
              :value="price"
              class="input price-input"
              inputmode="decimal"
              autocomplete="off"
              @input="onPrice"
            />
            <span class="field-hint" :class="{ 'field-hint--error': price !== '' && !priceValid }">
              <template v-if="price !== '' && !priceValid"
                >Enter a price above 0 and up to 110, with at most two decimals.</template
              >
              <template v-else
                >Equivalent yield
                <span class="mono ink strong">{{ yieldPct ? `${yieldPct}%` : '—' }}</span></template
              >
            </span>
          </label>

          <div class="field">
            <span class="field-label">Settlement account</span>
            <div class="account">
              <span
                >{{ store.summary?.settlementAccount.label }} ·
                <span class="mono">{{ store.summary?.settlementAccount.masked }}</span></span
              >
              <span class="muted small"
                >Available <span class="mono ink">{{ formatTzs(available) }}</span></span
              >
            </div>
          </div>

          <p v-if="closed" class="notice notice--error" role="alert">
            Bids for this auction have closed.
          </p>

          <div class="actions">
            <button
              type="button"
              class="btn btn-secondary"
              @click="router.push({ name: 'investor-auctions' })"
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="!canReview">Review bid</button>
          </div>
        </form>

        <!-- step 2: confirm with PIN -->
        <form v-else-if="step === 2" class="form" @submit.prevent="confirm">
          <p class="lead">
            Check the details on the right. When you confirm, {{ formatTzs(hold) }} is held on your
            settlement account. You can amend or withdraw the bid until
            {{ formatCutoff(auction.cutoffAt) }}.
          </p>
          <label class="field">
            <span class="field-label">Transaction PIN</span>
            <input
              :value="pin"
              type="password"
              class="input pin-input"
              inputmode="numeric"
              maxlength="4"
              placeholder="••••"
              autocomplete="one-time-code"
              @input="onPin"
            />
            <span v-if="DEMO && !LIVE_AUTH" class="field-hint">Demo: any 4 digits.</span>
          </label>
          <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
          <div class="actions">
            <button type="button" class="btn btn-secondary" :disabled="pending" @click="step = 1">
              Back
            </button>
            <button type="submit" class="btn btn-primary" :disabled="pin.length !== 4 || pending">
              {{ pending ? 'Placing bid…' : 'Confirm bid' }}
            </button>
          </div>
        </form>

        <!-- step 3: receipt -->
        <div v-else-if="placed" class="receipt">
          <div class="receipt-head">
            <h3 class="receipt-title">Bid received</h3>
            <StatusChip :status="placed.status" />
          </div>
          <dl class="receipt-grid">
            <dt>Bid reference</dt>
            <dd class="mono">{{ placed.reference }}</dd>
            <dt>Funds held</dt>
            <dd class="mono">{{ formatTzs(placed.heldAmount) }}</dd>
            <dt>Submitted to BoT</dt>
            <dd>By TCB Treasury before {{ formatCutoff(auction.cutoffAt) }}</dd>
          </dl>
          <p class="lead">
            We will send the result by SMS and in the portal as soon as the Bank of Tanzania
            publishes it. Any amount not allotted is released to your account straight away.
          </p>
          <div class="actions">
            <RouterLink :to="{ name: 'investor-bids' }" class="btn btn-primary"
              >View my bids</RouterLink
            >
            <RouterLink :to="{ name: 'investor-dashboard' }" class="btn btn-secondary"
              >Back to dashboard</RouterLink
            >
          </div>
        </div>
      </section>

      <aside v-if="step < 3" class="card summary" aria-labelledby="summary-title">
        <h2 id="summary-title" class="card-head card-head--lg">Bid summary</h2>
        <div class="summary-body">
          <div v-for="r in summaryRows" :key="r.label" class="summary-row">
            <span class="muted">{{ r.label }}</span>
            <span class="mono summary-value" :class="{ strong: r.strong }">{{ r.value }}</span>
          </div>
          <p v-if="insufficient" class="notice notice--error summary-warning" role="alert">
            Insufficient funds. The platform holds the full amount before accepting a bid. Lower the
            amount or top up your settlement account.
          </p>
        </div>
      </aside>
    </div>
  </template>
</template>

<style scoped>
.steps {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  list-style: none;
  margin: 0;
  padding: 0;
}
.step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: 20px;
  color: var(--muted);
}
.step--current {
  background: var(--blue-bg);
  color: var(--navy);
}
.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--border);
  color: var(--muted);
}
.step--current .step-dot,
.step--done .step-dot {
  background: var(--navy);
  color: #fff;
}
.step-label {
  font-size: 13px;
  font-weight: 500;
}

.form-card {
  flex: 3 1 460px;
}
.form-head {
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.closes {
  text-align: right;
}
.closes-label {
  font-size: 12px;
}
.closes-value {
  font-size: 16px;
  font-weight: 600;
}
.form {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.amount-input {
  max-width: 320px;
}
.price-input {
  max-width: 200px;
}
.pin-input {
  font-family: var(--font-mono);
  font-size: 20px;
  letter-spacing: 0.4em;
  width: 160px;
  font-weight: 500;
}
.account {
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  max-width: 460px;
  font-size: 14px;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.actions .btn {
  text-decoration: none;
  display: inline-block;
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

.receipt {
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.receipt-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.receipt-title {
  font-size: 22px;
  font-weight: 600;
}
.receipt-grid {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 10px 16px;
  font-size: 14px;
  margin: 0;
}
.receipt-grid dt {
  color: var(--muted);
}
.receipt-grid dd {
  margin: 0;
}

.summary {
  flex: 2 1 300px;
}
.summary-body {
  padding: 8px 24px 20px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--divider);
  font-size: 14px;
}
.summary-value {
  text-align: right;
}
.summary-warning {
  margin: 16px 0 0;
}
.empty {
  padding: 24px;
}
</style>

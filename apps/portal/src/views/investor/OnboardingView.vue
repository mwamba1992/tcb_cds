<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { IndividualProfile } from '../../api/live/account';
import { useAsync } from '../../composables/useAsync';
import { SOURCES_OF_FUNDS, TZ_REGIONS } from '../../lib/regions';
import { useAccountStore } from '../../stores/account';

/**
 * Onboarding for an individual investor: details → review and consent → status.
 *
 * Only what KYC needs is asked. Everything is checked against NIDA and TCB's own
 * records on submission; the status panel then follows the application through
 * review, the TCB account and the CDS account until the customer can bid.
 */
const account = useAccountStore();
const { pending, error, run } = useAsync();

const blank = (): IndividualProfile => ({
  nidaNumber: '',
  firstName: '',
  middleName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  email: '',
  region: '',
  district: '',
  address: '',
  occupation: '',
  sourceOfFunds: '',
  tin: '',
  pepDeclared: null,
  tcbAccount: '',
});
const form = reactive<IndividualProfile>(blank());
const hasTcbAccount = ref<boolean | null>(null);
const reviewing = ref(false);
const consents = reactive({ acceptTerms: false, acceptDataProcessing: false, acceptCdsMandate: false });

const status = computed(() => account.onboarding);
const editing = computed(() => ['profile', 'submit', 'provide_info'].includes(status.value?.nextStep ?? 'profile'));

onMounted(() => {
  if (!status.value) void account.refreshStatus();
});

watch(
  () => status.value?.profile,
  (saved) => {
    if (!saved) return;
    Object.assign(form, {
      ...saved,
      middleName: saved.middleName ?? '',
      email: saved.email ?? '',
      tin: saved.tin ?? '',
      tcbAccount: saved.tcbAccount ?? '',
    });
    hasTcbAccount.value = saved.tcbAccount ? true : hasTcbAccount.value;
  },
  { immediate: true },
);

const nidaDigits = computed(() => form.nidaNumber.replace(/\D/g, ''));
const nidaDisplay = computed({
  get: () => {
    const d = nidaDigits.value;
    return [d.slice(0, 8), d.slice(8, 13), d.slice(13, 18), d.slice(18, 20)].filter(Boolean).join('-');
  },
  set: (typed: string) => {
    form.nidaNumber = typed.replace(/\D/g, '').slice(0, 20);
  },
});
/** The NIN starts with the date of birth; saying so catches typos before NIDA does. */
const dobFromNin = computed(() => {
  const d = nidaDigits.value;
  return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
});
const dobMismatch = computed(
  () => !!form.dateOfBirth && nidaDigits.value.length === 20 && dobFromNin.value !== form.dateOfBirth,
);

const complete = computed(
  () =>
    nidaDigits.value.length === 20 &&
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    form.dateOfBirth !== '' &&
    form.gender !== '' &&
    form.region !== '' &&
    form.district.trim().length >= 2 &&
    form.address.trim().length >= 3 &&
    form.occupation.trim().length >= 2 &&
    form.sourceOfFunds !== '' &&
    form.pepDeclared !== null &&
    hasTcbAccount.value !== null &&
    (!hasTcbAccount.value || /^\d{10,16}$/.test(form.tcbAccount)),
);
const allConsented = computed(() => consents.acceptTerms && consents.acceptDataProcessing && consents.acceptCdsMandate);

async function saveAndReview() {
  if (!complete.value) return;
  const saved = await run(async () => {
    await account.saveProfile({ ...form, nidaNumber: nidaDigits.value, tcbAccount: hasTcbAccount.value ? form.tcbAccount : '' });
    return true;
  });
  if (saved) reviewing.value = true;
}

async function submit() {
  const done = await run(async () => {
    await account.submit({ ...consents });
    return true;
  });
  if (done) reviewing.value = false;
}

const fullName = computed(() => [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' '));
const sourceLabel = computed(() => SOURCES_OF_FUNDS.find((s) => s.value === form.sourceOfFunds)?.label ?? '');

type Stage = { label: string; detail: string; state: 'done' | 'current' | 'waiting' | 'failed' };
const stages = computed<Stage[]>(() => {
  const s = status.value;
  if (!s) return [];
  const approved = s.status === 'approved';
  const bank =
    s.bank.status === 'existing' || s.bank.status === 'opened'
      ? { detail: `TCB account ${s.bank.account ?? ''} linked`, state: 'done' as const }
      : s.bank.status === 'requested'
        ? { detail: 'Being opened for you at TCB. No branch visit needed.', state: 'current' as const }
        : { detail: 'Linked once your details are verified', state: 'waiting' as const };
  return [
    { label: 'Details submitted', detail: `Reference ${s.reference}`, state: 'done' },
    {
      label: 'Identity verified',
      detail:
        s.status === 'rejected'
          ? 'We could not verify your details. Please visit a TCB branch with your NIDA ID.'
          : approved
            ? 'Checked with NIDA and TCB records'
            : 'Our team is reviewing your details, usually within one working day',
      state: s.status === 'rejected' ? 'failed' : approved ? 'done' : 'current',
    },
    { label: 'TCB account', ...bank },
    {
      label: 'CDS account',
      detail:
        s.cds.status === 'active'
          ? `CDS account ${s.cds.account} open`
          : approved
            ? 'Requested from the Bank of Tanzania CDS'
            : 'Opened for you once your identity is verified',
      state: s.cds.status === 'active' ? 'done' : approved ? 'current' : 'waiting',
    },
  ];
});
</script>

<template>
  <p v-if="!status" class="muted" role="status">Loading…</p>

  <!-- status: submitted and beyond -->
  <section v-else-if="!editing" class="card status-card">
    <div class="card-head--lg">
      <h2 class="card-title">
        {{ status.canBid ? 'You are ready to bid' : status.status === 'rejected' ? 'Application not approved' : 'Your application' }}
      </h2>
      <p class="card-sub">We send an SMS at every step.</p>
    </div>
    <ol class="timeline">
      <li v-for="stage in stages" :key="stage.label" class="stage" :class="`stage--${stage.state}`">
        <span class="stage-dot" aria-hidden="true">{{ stage.state === 'done' ? '✓' : stage.state === 'failed' ? '!' : '' }}</span>
        <div>
          <div class="stage-label">{{ stage.label }}</div>
          <div class="stage-detail">{{ stage.detail }}</div>
        </div>
      </li>
    </ol>
    <div class="status-actions">
      <RouterLink v-if="status.canBid" class="btn btn-primary" :to="{ name: 'investor-auctions' }">See open auctions</RouterLink>
      <button v-else type="button" class="btn btn-secondary" :disabled="pending" @click="run(account.refreshStatus)">
        Check again
      </button>
    </div>
  </section>

  <!-- review and consent -->
  <section v-else-if="reviewing" class="card form-card">
    <div class="card-head--lg form-head">
      <h2 class="card-title">Check and submit</h2>
      <p class="card-sub">We will check these details with NIDA and TCB's records.</p>
    </div>
    <div class="form">
      <dl class="summary">
        <dt>Name</dt>
        <dd>{{ fullName }}</dd>
        <dt>NIDA number</dt>
        <dd class="mono">{{ nidaDisplay }}</dd>
        <dt>Date of birth</dt>
        <dd>{{ form.dateOfBirth }}</dd>
        <dt>Address</dt>
        <dd>{{ form.address }}, {{ form.district }}, {{ form.region }}</dd>
        <dt>Occupation</dt>
        <dd>{{ form.occupation }} · {{ sourceLabel }}</dd>
        <dt>TCB account</dt>
        <dd>{{ hasTcbAccount ? form.tcbAccount : 'None yet: TCB will open one for you' }}</dd>
      </dl>
      <fieldset class="consents">
        <legend class="field-label">Your agreement</legend>
        <label class="check">
          <input v-model="consents.acceptTerms" type="checkbox" />
          <span>I accept the TCB Government Securities terms and conditions.</span>
        </label>
        <label class="check">
          <input v-model="consents.acceptDataProcessing" type="checkbox" />
          <span>I agree that TCB may verify my details with NIDA and screen them as the law requires.</span>
        </label>
        <label class="check">
          <input v-model="consents.acceptCdsMandate" type="checkbox" />
          <span>I authorise TCB to open and operate a Central Depository System account in my name.</span>
        </label>
      </fieldset>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" :disabled="pending" @click="reviewing = false">Edit details</button>
        <button type="button" class="btn btn-primary" :disabled="pending || !allConsented" @click="submit">
          {{ pending ? 'Submitting…' : 'Submit for verification' }}
        </button>
      </div>
    </div>
  </section>

  <!-- details -->
  <form v-else class="card form-card" @submit.prevent="saveAndReview">
    <div class="card-head--lg form-head">
      <h2 class="card-title">Your details</h2>
      <p class="card-sub">As they appear on your NIDA ID. Takes about three minutes.</p>
    </div>
    <p v-if="status.nextStep === 'provide_info'" class="notice notice--info banner">
      Our team needs you to check your details. Correct anything that differs from your NIDA ID,
      then submit again.
    </p>
    <div class="form">
      <fieldset class="group">
        <legend class="group-title">Identity</legend>
        <label class="field wide">
          <span class="field-label">NIDA number</span>
          <input v-model="nidaDisplay" class="input input--text mono" inputmode="numeric" placeholder="19900521-13105-00001-37" autocomplete="off" />
        </label>
        <label class="field">
          <span class="field-label">First name</span>
          <input v-model="form.firstName" class="input input--text" autocomplete="given-name" />
        </label>
        <label class="field">
          <span class="field-label">Middle name <span class="muted">(optional)</span></span>
          <input v-model="form.middleName" class="input input--text" autocomplete="additional-name" />
        </label>
        <label class="field">
          <span class="field-label">Last name</span>
          <input v-model="form.lastName" class="input input--text" autocomplete="family-name" />
        </label>
        <label class="field">
          <span class="field-label">Date of birth</span>
          <input v-model="form.dateOfBirth" class="input input--text" type="date" autocomplete="bday" :aria-invalid="dobMismatch" />
          <span v-if="dobMismatch" class="field-hint field-hint--error">Your NIDA number says {{ dobFromNin }}.</span>
        </label>
        <label class="field">
          <span class="field-label">Sex</span>
          <select v-model="form.gender" class="input input--text">
            <option value="" disabled>Choose</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
        </label>
      </fieldset>

      <fieldset class="group">
        <legend class="group-title">Contact and address</legend>
        <label class="field">
          <span class="field-label">Region</span>
          <select v-model="form.region" class="input input--text">
            <option value="" disabled>Choose</option>
            <option v-for="r in TZ_REGIONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">District</span>
          <input v-model="form.district" class="input input--text" />
        </label>
        <label class="field wide">
          <span class="field-label">Street address</span>
          <input v-model="form.address" class="input input--text" autocomplete="street-address" />
        </label>
        <label class="field wide">
          <span class="field-label">Email <span class="muted">(optional, for statements)</span></span>
          <input v-model="form.email" class="input input--text" type="email" autocomplete="email" />
        </label>
      </fieldset>

      <fieldset class="group">
        <legend class="group-title">Money and tax</legend>
        <label class="field">
          <span class="field-label">Occupation</span>
          <input v-model="form.occupation" class="input input--text" autocomplete="organization-title" />
        </label>
        <label class="field">
          <span class="field-label">Main source of the money you will invest</span>
          <select v-model="form.sourceOfFunds" class="input input--text">
            <option value="" disabled>Choose</option>
            <option v-for="s in SOURCES_OF_FUNDS" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">TIN <span class="muted">(optional)</span></span>
          <input v-model="form.tin" class="input input--text mono" inputmode="numeric" placeholder="123-456-789" />
        </label>
        <div class="field wide">
          <span class="field-label">Do you, or a close family member, hold a senior public office?</span>
          <span class="field-hint">For example a minister, MP, judge, senior civil servant or military officer.</span>
          <div class="choices">
            <label class="check"><input v-model="form.pepDeclared" type="radio" :value="false" /> No</label>
            <label class="check"><input v-model="form.pepDeclared" type="radio" :value="true" /> Yes</label>
          </div>
        </div>
      </fieldset>

      <fieldset class="group">
        <legend class="group-title">TCB account</legend>
        <div class="field wide">
          <span class="field-label">Do you already have a TCB account?</span>
          <span class="field-hint">Bids are paid from it, and interest and maturities are paid into it.</span>
          <div class="choices">
            <label class="check"><input v-model="hasTcbAccount" type="radio" :value="true" /> Yes</label>
            <label class="check"><input v-model="hasTcbAccount" type="radio" :value="false" /> No, open one for me</label>
          </div>
        </div>
        <label v-if="hasTcbAccount" class="field">
          <span class="field-label">Account number</span>
          <input v-model="form.tcbAccount" class="input input--text mono" inputmode="numeric" placeholder="0150311875201" />
        </label>
      </fieldset>

      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="submit" class="btn btn-primary" :disabled="pending || !complete">
          {{ pending ? 'Saving…' : 'Continue' }}
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.form-card,
.status-card {
  max-width: 880px;
}
.form-head {
  border-bottom: 1px solid var(--border);
}
.form {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.banner {
  margin: 20px 24px 0;
}
.group {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px 20px;
}
.group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--navy);
  margin-bottom: 12px;
  padding: 0;
}
.wide {
  grid-column: 1 / -1;
}
.choices {
  display: flex;
  gap: 24px;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.actions .btn,
.status-actions .btn {
  text-decoration: none;
  display: inline-block;
}
.summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 24px;
  margin: 0;
  font-size: 14px;
}
.summary dt {
  color: var(--muted);
}
.summary dd {
  margin: 0;
}
.consents {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.consents legend {
  margin-bottom: 12px;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 8px 24px 8px;
}
.stage {
  display: flex;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid var(--divider);
}
.stage:last-child {
  border-bottom: 0;
}
.stage-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  border: 2px solid var(--border);
  color: #fff;
}
.stage--done .stage-dot {
  background: var(--green-fg);
  border-color: var(--green-fg);
}
.stage--current .stage-dot {
  border-color: var(--navy);
  box-shadow: inset 0 0 0 4px #fff;
  background: var(--navy);
}
.stage--failed .stage-dot {
  background: var(--red-fg);
  border-color: var(--red-fg);
}
.stage-label {
  font-weight: 600;
  font-size: 14px;
}
.stage--waiting .stage-label {
  color: var(--muted);
}
.stage-detail {
  font-size: 13px;
  color: var(--muted);
  margin-top: 2px;
}
.status-actions {
  padding: 0 24px 24px;
}

@media (max-width: 600px) {
  .form {
    padding: 16px;
  }
  .summary {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .summary dd {
    margin-bottom: 10px;
  }
}
</style>

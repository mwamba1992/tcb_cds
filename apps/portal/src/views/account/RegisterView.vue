<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { accountApi } from '../../api/live/account';
import AuthLayout from '../../components/AuthLayout.vue';
import { useAsync } from '../../composables/useAsync';
import { useAccountStore } from '../../stores/account';
import CodeResend from './CodeResend.vue';
import PinFields from './PinFields.vue';

/**
 * Registration: prove the phone, then choose a PIN. Personal details and the KYC
 * checks follow on the onboarding screen, once the customer has an account to come
 * back to.
 */
const account = useAccountStore();
const router = useRouter();
const { pending, error, run } = useAsync();

const step = ref<1 | 2 | 3>(1);
const phone = ref('');
const code = ref('');
const resendAfter = ref<string | null>(null);
const newPin = ref<string | null>(null);

const steps = computed(() =>
  ['Mobile number', 'Verify', 'PIN'].map((label, index) => {
    const n = index + 1;
    return { n, label, done: n < step.value, current: n === step.value };
  }),
);
const title = computed(() =>
  step.value === 1 ? 'Create your account' : step.value === 2 ? 'Enter the code' : 'Choose your PIN',
);
const subtitle = computed(() =>
  step.value === 1
    ? 'We will send a code by SMS to confirm the number is yours.'
    : step.value === 2
      ? `We sent a 6-digit code to ${phone.value}. It expires in 5 minutes.`
      : 'Your PIN signs you in and approves your bids. Never share it, not even with TCB staff.',
);

async function sendCode() {
  if (phone.value.trim().length < 9) {
    error.value = 'Enter your mobile number, for example 0712 345 678.';
    return;
  }
  const sent = await run(() => accountApi.startRegistration(phone.value));
  if (sent) {
    resendAfter.value = sent.resendAfter;
    code.value = '';
    step.value = 2;
  }
}

async function verify() {
  if (code.value.length !== 6) {
    error.value = 'Enter the 6-digit code from the SMS.';
    return;
  }
  const done = await run(() => account.completeRegistration(phone.value, code.value));
  if (done) step.value = 3;
}

async function savePin() {
  if (!newPin.value) {
    error.value = 'Enter the same 4-digit PIN in both boxes.';
    return;
  }
  const pin = newPin.value;
  const done = await run(async () => {
    await account.setPin(pin);
    return true;
  });
  if (done) await router.replace({ name: 'investor-onboarding' });
}

function onCode(event: Event) {
  code.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
}
</script>

<template>
  <AuthLayout :title="title" :subtitle="subtitle">
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

    <form v-if="step === 1" class="form" @submit.prevent="sendCode">
      <label class="field">
        <span class="field-label">Mobile number</span>
        <input
          v-model="phone"
          class="input input--text"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          placeholder="0712 345 678"
          required
        />
        <span class="field-hint">Vodacom, Airtel, Tigo, Halotel or TTCL. This is also where results are sent.</span>
      </label>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="pending">
        {{ pending ? 'Sending…' : 'Send code' }}
      </button>
    </form>

    <form v-else-if="step === 2" class="form" @submit.prevent="verify">
      <label class="field">
        <span class="field-label">Verification code</span>
        <input
          :value="code"
          class="input code-input"
          inputmode="numeric"
          maxlength="6"
          placeholder="••••••"
          autocomplete="one-time-code"
          @input="onCode"
        />
      </label>
      <CodeResend :resend-after="resendAfter" :pending="pending" @resend="sendCode" />
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" :disabled="pending" @click="step = 1">
          Change number
        </button>
        <button class="btn btn-primary" type="submit" :disabled="pending">
          {{ pending ? 'Checking…' : 'Verify' }}
        </button>
      </div>
    </form>

    <form v-else class="form" @submit.prevent="savePin">
      <PinFields @change="newPin = $event" />
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="pending">
        {{ pending ? 'Saving…' : 'Set PIN and continue' }}
      </button>
    </form>

    <template #footer>
      <span>Already registered? <RouterLink :to="{ name: 'account-sign-in' }">Sign in</RouterLink></span>
    </template>
  </AuthLayout>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.steps {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  list-style: none;
  margin: 0 0 22px;
  padding: 0;
}
.step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 5px;
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
</style>

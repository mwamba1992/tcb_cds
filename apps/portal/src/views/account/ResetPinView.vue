<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { accountApi } from '../../api/live/account';
import AuthLayout from '../../components/AuthLayout.vue';
import { useAsync } from '../../composables/useAsync';
import { useAccountStore } from '../../stores/account';
import CodeResend from './CodeResend.vue';
import PinFields from './PinFields.vue';

/** Forgotten or locked PIN: a code to the registered phone, then a new PIN. */
const account = useAccountStore();
const router = useRouter();
const { pending, error, run } = useAsync();

const step = ref<1 | 2>(1);
const phone = ref('');
const code = ref('');
const resendAfter = ref<string | null>(null);
const newPin = ref<string | null>(null);

async function sendCode() {
  if (phone.value.trim().length < 9) {
    error.value = 'Enter your registered mobile number.';
    return;
  }
  const sent = await run(() => accountApi.startPinReset(phone.value));
  if (sent) {
    resendAfter.value = sent.resendAfter;
    step.value = 2;
  }
}

async function reset() {
  if (code.value.length !== 6 || !newPin.value) {
    error.value = 'Enter the 6-digit code and the same new PIN in both boxes.';
    return;
  }
  const pin = newPin.value;
  const done = await run(async () => {
    await account.completePinReset(phone.value, code.value, pin);
    return true;
  });
  if (done) await router.replace({ name: 'investor-dashboard' });
}

function onCode(event: Event) {
  code.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
}
</script>

<template>
  <AuthLayout
    title="Reset your PIN"
    :subtitle="
      step === 1
        ? 'Enter your registered mobile number. If it is registered, we will send a code by SMS.'
        : `Enter the code sent to ${phone} and choose a new PIN. You will be signed out on other devices.`
    "
  >
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
      </label>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="pending">
        {{ pending ? 'Sending…' : 'Send code' }}
      </button>
    </form>

    <form v-else class="form" @submit.prevent="reset">
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
      <PinFields @change="newPin = $event" />
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="pending">
        {{ pending ? 'Saving…' : 'Reset PIN' }}
      </button>
    </form>

    <template #footer>
      <RouterLink :to="{ name: 'account-sign-in' }">Back to sign in</RouterLink>
    </template>
  </AuthLayout>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>

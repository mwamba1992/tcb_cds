<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AccountError } from '../../api/live/http';
import AuthLayout from '../../components/AuthLayout.vue';
import { useAsync } from '../../composables/useAsync';
import { useAccountStore } from '../../stores/account';

const account = useAccountStore();
const router = useRouter();
const route = useRoute();
const { pending, error, run } = useAsync();

const phone = ref('');
const pin = ref('');
const locked = shallowRef(false);

function onPin(event: Event) {
  pin.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4);
}

async function signIn() {
  locked.value = false;
  if (phone.value.trim().length < 9 || pin.value.length !== 4) {
    error.value = 'Enter your mobile number and your 4-digit PIN.';
    return;
  }
  const ok = await run(async () => {
    try {
      await account.signIn(phone.value, pin.value);
      return true;
    } catch (caught) {
      if (caught instanceof AccountError && caught.code === 'pin_locked') locked.value = true;
      throw caught;
    }
  });
  pin.value = '';
  if (ok) {
    const next = typeof route.query['next'] === 'string' ? route.query['next'] : null;
    await router.replace(next?.startsWith('/invest') ? next : { name: 'investor-dashboard' });
  }
}
</script>

<template>
  <AuthLayout title="Sign in" subtitle="Use the mobile number you registered with and your 4-digit PIN.">
    <form class="form" @submit.prevent="signIn">
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
      <label class="field">
        <span class="field-label">PIN</span>
        <input
          :value="pin"
          class="input pin-input"
          type="password"
          inputmode="numeric"
          maxlength="4"
          placeholder="••••"
          autocomplete="current-password"
          @input="onPin"
        />
      </label>
      <p v-if="error" class="notice notice--error" role="alert">
        {{ error }}
        <RouterLink v-if="locked" :to="{ name: 'account-reset-pin' }">Reset PIN</RouterLink>
      </p>
      <button class="btn btn-primary submit" type="submit" :disabled="pending">
        {{ pending ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
    <template #footer>
      <RouterLink :to="{ name: 'account-register' }">Create an account</RouterLink>
      <RouterLink :to="{ name: 'account-reset-pin' }">Forgotten your PIN?</RouterLink>
    </template>
  </AuthLayout>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.submit {
  padding: 12px 16px;
  font-size: 15px;
}
</style>

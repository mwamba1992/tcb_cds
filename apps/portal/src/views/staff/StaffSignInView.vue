<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '../../components/AuthLayout.vue';
import { useAsync } from '../../composables/useAsync';
import { DEMO } from '../../config/portal';
import { useAccountStore } from '../../stores/account';

/**
 * Development sign-in for staff. In production this screen is replaced by TCB's own
 * sign-in (directory or SSO), which identity refuses to bypass.
 */
const account = useAccountStore();
const router = useRouter();
const route = useRoute();
const { pending, error, run } = useAsync();

const username = ref('');
const password = ref('');

async function signIn() {
  const ok = await run(async () => {
    await account.staffSignIn(username.value, password.value);
    return true;
  });
  password.value = '';
  if (!ok) return;
  if (!account.isStaff) {
    await account.signOut();
    error.value = 'This is not a staff account.';
    return;
  }
  const next = typeof route.query['next'] === 'string' ? route.query['next'] : null;
  await router.replace(next?.startsWith('/ops') ? next : { name: 'staff-overview' });
}
</script>

<template>
  <AuthLayout audience="staff" title="Back-office sign in" subtitle="Sign in with your TCB staff account.">
    <form class="form" @submit.prevent="signIn">
      <label class="field">
        <span class="field-label">Username</span>
        <input v-model="username" class="input input--text" autocomplete="username" placeholder="firstname.lastname" required />
      </label>
      <label class="field">
        <span class="field-label">Password</span>
        <input v-model="password" class="input input--text" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="pending || !username || !password">
        {{ pending ? 'Signing in…' : 'Sign in' }}
      </button>
      <p v-if="DEMO" class="notice">
        Development accounts: <span class="mono">rose.mollel</span> (maker),
        <span class="mono">salum.kweka</span> (checker), <span class="mono">neema.lyimo</span> (compliance),
        <span class="mono">faraji.mrema</span> (treasury). Created by <span class="mono">scripts/dev-seed-staff.mjs</span>.
      </p>
    </form>
  </AuthLayout>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>

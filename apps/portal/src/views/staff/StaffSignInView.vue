<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '../../components/AuthLayout.vue';
import { useAsync } from '../../composables/useAsync';
import { landingFor } from '../../router';
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

const DEV_ACCOUNTS = [
  { username: 'rose.mollel', role: 'Maker' },
  { username: 'salum.kweka', role: 'Checker' },
  { username: 'neema.lyimo', role: 'Compliance' },
  { username: 'faraji.mrema', role: 'Treasury' },
  { username: 'amani.ict', role: 'ICT admin' },
];

function fill(user: string) {
  username.value = user;
  password.value = 'Govsec-dev-2026';
  error.value = null;
}

async function signIn() {
  if (!username.value.trim() || !password.value) {
    error.value = 'Enter your username and password.';
    return;
  }
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
  await router.replace(next?.startsWith('/ops') ? next : landingFor('staff'));
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
      <button class="btn btn-primary submit" type="submit" :disabled="pending">
        {{ pending ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
    <template #dev>
      <div class="dev">
        <div class="dev-head"><span class="dev-tag">Development</span> Sign in as</div>
        <button v-for="a in DEV_ACCOUNTS" :key="a.username" type="button" class="dev-chip" @click="fill(a.username)">
          {{ a.role }}
        </button>
      </div>
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
.dev {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}
.dev-head {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.dev-tag {
  background: var(--amber-bg);
  color: var(--amber-fg);
  font-weight: 600;
  border-radius: var(--radius-chip);
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
}
.dev-chip {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
}
.dev-chip:hover {
  border-color: var(--navy);
}
</style>

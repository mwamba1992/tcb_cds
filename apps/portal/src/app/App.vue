<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import OnboardingBanner from '../components/OnboardingBanner.vue';
import { HAS_INVESTOR, HAS_STAFF, LIVE_AUTH } from '../config/portal';
import { useAccountStore } from '../stores/account';
import { useInvestorStore } from '../stores/investor';
import { useOperationsStore } from '../stores/operations';

const investor = useInvestorStore();
const ops = useOperationsStore();
const route = useRoute();
const account = useAccountStore();

// Live back office: its queues load once a staff member is signed in, and are dropped
// on sign-out so the next person never sees the previous one's data.
if (LIVE_AUTH && HAS_STAFF) {
  watch(
    () => account.isStaff,
    (staff) => (staff ? void ops.load() : ops.reset()),
    { immediate: true },
  );
}

// Live investor portal: load once an investor is signed in, and again as their
// onboarding moves on (a CDS account arriving makes them able to bid).
if (LIVE_AUTH && HAS_INVESTOR) {
  watch(
    () => [account.isInvestor, account.onboarding?.canBid] as const,
    ([investorSignedIn]) => {
      if (investorSignedIn) void investor.load();
    },
    { immediate: true },
  );
}

onMounted(() => {
  if (HAS_INVESTOR && !LIVE_AUTH) void investor.load();
  if (HAS_STAFF && !LIVE_AUTH) void ops.load();
});
</script>

<template>
  <RouterView v-if="route.meta.layout === 'auth'" />
  <AppShell v-else>
    <OnboardingBanner v-if="route.meta.portal === 'investor'" />
    <RouterView />
  </AppShell>
</template>

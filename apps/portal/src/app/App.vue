<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import OnboardingBanner from '../components/OnboardingBanner.vue';
import { HAS_INVESTOR, HAS_STAFF } from '../config/portal';
import { useInvestorStore } from '../stores/investor';
import { useOperationsStore } from '../stores/operations';

const investor = useInvestorStore();
const ops = useOperationsStore();
const route = useRoute();

onMounted(() => {
  if (HAS_INVESTOR) void investor.load();
  if (HAS_STAFF) void ops.load();
});
</script>

<template>
  <RouterView v-if="route.meta.layout === 'auth'" />
  <AppShell v-else>
    <OnboardingBanner v-if="route.meta.portal === 'investor'" />
    <RouterView />
  </AppShell>
</template>

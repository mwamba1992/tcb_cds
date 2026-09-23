<script setup lang="ts">
import { onMounted } from 'vue';
import AppShell from '../components/AppShell.vue';
import { HAS_INVESTOR, HAS_STAFF } from '../config/portal';
import { useInvestorStore } from '../stores/investor';
import { useOperationsStore } from '../stores/operations';

const investor = useInvestorStore();
const ops = useOperationsStore();

onMounted(() => {
  if (HAS_INVESTOR) void investor.load();
  if (HAS_STAFF) void ops.load();
});
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAccountStore } from '../stores/account';

/**
 * Until the investor can bid, every investor screen says what is missing and where to
 * go next. Bidding itself is also blocked by the router, so this is guidance, not the
 * control.
 */
const account = useAccountStore();
const route = useRoute();

const message = computed(() => {
  const s = account.onboarding;
  if (!s || s.canBid || route.name === 'investor-onboarding') return null;
  switch (s.nextStep) {
    case 'profile':
    case 'submit':
      return { tone: 'info', text: 'Complete your details to start investing. It takes about three minutes.', action: 'Continue' };
    case 'provide_info':
      return { tone: 'error', text: 'Our team needs you to check your details before we can continue.', action: 'Review details' };
    case 'under_review':
      return { tone: 'info', text: 'We are verifying your details, usually within one working day. You can look around meanwhile.', action: 'See progress' };
    case 'awaiting_cds':
      return { tone: 'info', text: 'Verified. Your CDS account is being opened; we will send an SMS when you can bid.', action: 'See progress' };
    case 'rejected':
      return { tone: 'error', text: 'We could not verify your details. Please visit a TCB branch with your NIDA ID.', action: 'Details' };
    default:
      return null;
  }
});
</script>

<template>
  <div v-if="message" class="notice banner" :class="message.tone === 'error' ? 'notice--error' : 'notice--info'" role="status">
    <span>{{ message.text }}</span>
    <RouterLink class="btn btn--sm btn-primary" :to="{ name: 'investor-onboarding' }">{{ message.action }}</RouterLink>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 14px;
}
.banner .btn {
  text-decoration: none;
}
</style>

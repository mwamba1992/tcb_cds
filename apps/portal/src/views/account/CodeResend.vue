<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '../../composables/useNow';

/** "Send a new code", enabled once the server's resend time has passed. */
const props = defineProps<{ resendAfter: string | null; pending: boolean }>();
defineEmits<{ resend: [] }>();
const now = useNow();

const wait = computed(() =>
  props.resendAfter ? Math.max(0, Math.ceil((Date.parse(props.resendAfter) - now.value) / 1000)) : 0,
);
</script>

<template>
  <p class="resend muted">
    Did not get it?
    <button type="button" class="btn-link link" :disabled="wait > 0 || pending" @click="$emit('resend')">
      Send a new code</button
    ><span v-if="wait > 0"> in {{ wait }} s</span>
  </p>
</template>

<style scoped>
.resend {
  font-size: 13px;
  margin: 0;
}
.link {
  color: var(--navy);
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
}
.link:disabled {
  color: var(--disabled);
  text-decoration: none;
}
</style>

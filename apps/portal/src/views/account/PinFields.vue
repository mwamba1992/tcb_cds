<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * A new PIN, typed twice. Emits the PIN once both agree, null otherwise. The rules the
 * server enforces (no repeats, runs or common PINs) are explained up front, so the
 * customer does not learn them one refusal at a time.
 */
const emit = defineEmits<{ change: [pin: string | null] }>();
const pin = ref('');
const again = ref('');

const clean = (event: Event) => (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4);
const mismatch = computed(() => again.value.length === 4 && again.value !== pin.value);

watch([pin, again], () => {
  emit('change', pin.value.length === 4 && pin.value === again.value ? pin.value : null);
});
</script>

<template>
  <div class="pins">
    <label class="field">
      <span class="field-label">New PIN</span>
      <input
        :value="pin"
        class="input pin-input"
        type="password"
        inputmode="numeric"
        maxlength="4"
        placeholder="••••"
        autocomplete="new-password"
        @input="pin = clean($event)"
      />
    </label>
    <label class="field">
      <span class="field-label">Type it again</span>
      <input
        :value="again"
        class="input pin-input"
        type="password"
        inputmode="numeric"
        maxlength="4"
        placeholder="••••"
        autocomplete="new-password"
        :aria-invalid="mismatch"
        @input="again = clean($event)"
      />
    </label>
  </div>
  <p class="field-hint" :class="{ 'field-hint--error': mismatch }">
    <template v-if="mismatch">The two PINs are different.</template>
    <template v-else
      >4 digits. Avoid repeats (1111), runs (1234) and dates people know. You will use it to sign
      in and to approve every bid.</template
    >
  </p>
</template>

<style scoped>
.pins {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
</style>

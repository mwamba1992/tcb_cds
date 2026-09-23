<script setup lang="ts" generic="T extends string">
defineProps<{
  options: readonly { value: T; label: string }[];
  label: string;
  size?: 'sm' | 'md';
}>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      class="segment"
      :class="{ 'segment--active': model === option.value, 'segment--md': size === 'md' }"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  background: var(--divider);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
  align-self: flex-start;
}
.segment {
  border: none;
  border-radius: var(--radius-control);
  padding: 6px 12px;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--muted);
}
.segment--md {
  padding: 8px 14px;
}
.segment--active {
  background: #fff;
  color: var(--ink);
}
</style>

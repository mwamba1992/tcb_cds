<script setup lang="ts">
import { computed } from 'vue';
import { toneOf, type Tone } from '../lib/status';

const props = defineProps<{ status: string; tone?: Tone; small?: boolean }>();
const resolved = computed(() => props.tone ?? toneOf(props.status));
</script>

<template>
  <span class="chip" :class="[`chip--${resolved}`, { 'chip--small': small }]">{{ status }}</span>
</template>

<style scoped>
.chip {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: var(--radius-chip);
  white-space: nowrap;
}
.chip--small {
  padding: 2px 7px;
}
.chip--green {
  background: var(--green-bg);
  color: var(--green-fg);
}
.chip--amber {
  background: var(--amber-bg);
  color: var(--amber-fg);
}
.chip--blue {
  background: var(--blue-bg);
  color: var(--blue-fg);
}
.chip--red {
  background: var(--red-bg);
  color: var(--red-fg);
}
.chip--grey {
  background: var(--grey-bg);
  color: var(--grey-fg);
}
</style>

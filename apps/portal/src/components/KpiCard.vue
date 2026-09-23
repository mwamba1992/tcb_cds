<script setup lang="ts">
defineProps<{ label: string; value: string; note?: string; tone?: 'muted' | 'bad' | 'good' }>();
</script>

<template>
  <div class="card kpi">
    <div class="kpi-label">{{ label }}</div>
    <div class="kpi-value num">{{ value }}</div>
    <div v-if="note" class="kpi-note" :class="`kpi-note--${tone ?? 'muted'}`">{{ note }}</div>
  </div>
</template>

<style scoped>
.kpi {
  padding: 18px 20px;
}
.kpi-label {
  font-size: 13px;
  color: var(--muted);
}
.kpi-value {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-top: 8px;
}
.kpi-note {
  font-size: 13px;
  margin-top: 4px;
}
.kpi-note--muted {
  color: var(--muted);
}
.kpi-note--bad {
  color: var(--red-fg);
}
.kpi-note--good {
  color: var(--green-fg);
}
</style>

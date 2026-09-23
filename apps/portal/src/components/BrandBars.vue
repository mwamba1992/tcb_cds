<script setup lang="ts">
/** The three TCB logo colours as a mark: vertical bars, or a stacked edge strip. */
defineProps<{ variant?: 'bars' | 'edge' }>();
</script>

<template>
  <span v-if="variant === 'edge'" class="edge" aria-hidden="true">
    <span class="y"></span><span class="g"></span><span class="b"></span>
  </span>
  <span v-else class="bars" aria-hidden="true">
    <span class="y"></span><span class="g"></span><span class="b"></span>
  </span>
</template>

<style scoped>
.bars {
  display: inline-flex;
  gap: 2px;
}
.bars span {
  width: 4px;
  height: 14px;
  border-radius: 1px;
}
.edge {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  display: flex;
  flex-direction: column;
}
.edge span {
  flex: 1;
}
.y {
  background: var(--brand-yellow);
}
.g {
  background: var(--brand-green);
}
.b {
  background: var(--brand-blue);
}
</style>

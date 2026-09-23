<script setup lang="ts">
/** The design's stroke icons, keyed by nav item. */
const PATHS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  auctions: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bids: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  kyc: 'M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM16 11l2 2 4-4',
  submit: 'M21 3 10 14M21 3l-6.5 18-4-8-8-4z',
  recon: 'M4 8h14l-3-3M20 16H6l3 3',
} as const;

export type IconName = keyof typeof PATHS;
defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

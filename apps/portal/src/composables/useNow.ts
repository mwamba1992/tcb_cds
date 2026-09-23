import { onScopeDispose, ref } from 'vue';

/**
 * A clock that ticks every second, for countdowns.
 *
 * One interval per component that asks for it, cleared when the component goes away.
 */
export function useNow(intervalMs = 1000) {
  const now = ref(Date.now());
  const timer = setInterval(() => {
    now.value = Date.now();
  }, intervalMs);
  onScopeDispose(() => clearInterval(timer));
  return now;
}

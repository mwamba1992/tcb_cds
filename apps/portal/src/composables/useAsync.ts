import { ref, shallowRef } from 'vue';
import { AccountError } from '../api/live/http';
import { ApiError } from '../api/types';

/**
 * Runs an API call and exposes `pending` and a human-readable `error`.
 *
 * Errors from the platform carry a message written for the user; anything else is an
 * unexpected failure and gets a generic sentence rather than a stack trace.
 */
export function useAsync() {
  const pending = ref(false);
  const error = shallowRef<string | null>(null);

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    pending.value = true;
    error.value = null;
    try {
      return await task();
    } catch (caught) {
      error.value =
        caught instanceof ApiError || caught instanceof AccountError
          ? caught.message
          : 'Something went wrong. Please try again, or contact TCB if it continues.';
      return undefined;
    } finally {
      pending.value = false;
    }
  }

  return { pending, error, run };
}

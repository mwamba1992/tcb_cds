<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { AccountError } from '../api/live/http';

/**
 * A back-office change, confirmed with a reason. The reason is required and goes into
 * the audit trail beside the staff member's name, so every change can be explained
 * later without asking who did it.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    tone?: 'primary' | 'danger' | 'success';
    reasonLabel?: string;
    reasonPlaceholder?: string;
    /** Runs the change; throwing keeps the dialog open with the error. */
    action: (reason: string) => Promise<unknown>;
  }>(),
  { description: undefined, tone: 'primary', reasonLabel: 'Reason', reasonPlaceholder: undefined },
);
const emit = defineEmits<{ close: []; done: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const reason = ref('');
const pending = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open) {
      reason.value = '';
      error.value = null;
      dialog.value?.showModal();
    } else {
      dialog.value?.close();
    }
  },
  { immediate: true },
);

async function confirm() {
  if (reason.value.trim().length < 3) {
    error.value = 'Give a reason of at least 3 characters.';
    return;
  }
  pending.value = true;
  error.value = null;
  try {
    await props.action(reason.value.trim());
    emit('done');
    emit('close');
  } catch (caught) {
    error.value = caught instanceof AccountError ? caught.message : 'That did not work. Try again.';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')" @cancel.prevent="emit('close')">
    <form class="dialog-body" @submit.prevent="confirm">
      <h2 class="dialog-title">{{ title }}</h2>
      <p v-if="description" class="dialog-desc">{{ description }}</p>
      <slot />
      <label class="field">
        <span class="field-label">{{ reasonLabel }}</span>
        <textarea v-model="reason" class="input input--text" rows="3" maxlength="500" :placeholder="reasonPlaceholder" />
        <span class="field-hint">Recorded in the audit trail with your name.</span>
      </label>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" :disabled="pending" @click="emit('close')">Cancel</button>
        <button
          type="submit"
          class="btn"
          :class="tone === 'danger' ? 'btn-danger-solid' : tone === 'success' ? 'btn-success' : 'btn-primary'"
          :disabled="pending"
        >
          {{ pending ? 'Working…' : confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  border: 0;
  border-radius: var(--radius-card);
  padding: 0;
  width: min(520px, calc(100vw - 32px));
  box-shadow: 0 20px 60px -20px rgba(29, 35, 79, 0.45);
}
.dialog::backdrop {
  background: rgba(19, 32, 46, 0.45);
}
.dialog-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dialog-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.dialog-desc {
  margin: -8px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.btn-danger-solid {
  background: var(--red-fg);
  color: #fff;
  font-weight: 600;
}
textarea.input {
  resize: vertical;
  font-family: inherit;
}
</style>

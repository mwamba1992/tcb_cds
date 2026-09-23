import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  api,
  type Batch,
  type KycAction,
  type KycCase,
  type OpsOverview,
  type ReconRun,
} from '../api';
import { useSessionStore } from './session';

/** The back-office's queues and controls. */
export const useOperationsStore = defineStore('operations', () => {
  const overview = ref<OpsOverview | null>(null);
  const kyc = ref<KycCase[]>([]);
  const batches = ref<Batch[]>([]);
  const recon = ref<ReconRun | null>(null);
  const loaded = ref(false);
  let poll: ReturnType<typeof setTimeout> | null = null;

  async function load() {
    const [o, k, b, r] = await Promise.all([
      api.opsOverview(),
      api.kycCases(),
      api.batches(),
      api.reconciliation(),
    ]);
    overview.value = o;
    kyc.value = k;
    batches.value = b;
    recon.value = r;
    loaded.value = true;
  }

  const actor = () => useSessionStore().user;

  async function actOnKyc(caseId: string, action: KycAction) {
    const updated = await api.actOnKyc(caseId, action, actor());
    kyc.value = kyc.value.map((k) => (k.id === updated.id ? updated : k));
  }

  async function refreshBatches() {
    const [b, o] = await Promise.all([api.batches(), api.opsOverview()]);
    batches.value = b;
    overview.value = o;
  }

  /** While BoT has not acknowledged a submission, check again shortly. */
  function watchSubmissions() {
    if (poll) clearTimeout(poll);
    if (!batches.value.some((b) => b.stage === 'Submitting')) return;
    poll = setTimeout(async () => {
      await refreshBatches();
      watchSubmissions();
    }, 800);
  }

  async function prepareBatch(batchId: string) {
    await api.prepareBatch(batchId, actor());
    await refreshBatches();
  }

  async function approveBatch(batchId: string) {
    await api.approveBatch(batchId, actor());
    await refreshBatches();
    watchSubmissions();
  }

  async function resolveBreak(rowId: string) {
    await api.resolveBreak(rowId, actor());
    recon.value = await api.reconciliation();
  }

  return {
    overview,
    kyc,
    batches,
    recon,
    loaded,
    load,
    actOnKyc,
    prepareBatch,
    approveBatch,
    resolveBreak,
  };
});

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
import { backofficeApi, type CdsTask } from '../api/live/backoffice';
import { submissionApi } from '../api/live/bidding';
import { LIVE_AUTH } from '../config/portal';
import { useSessionStore } from './session';

/** The back-office's queues and controls. */
export const useOperationsStore = defineStore('operations', () => {
  const overview = ref<OpsOverview | null>(null);
  const kyc = ref<KycCase[]>([]);
  const batches = ref<Batch[]>([]);
  const recon = ref<ReconRun | null>(null);
  const loaded = ref(false);
  const cdsTasks = ref<CdsTask[]>([]);
  let poll: ReturnType<typeof setTimeout> | null = null;

  /**
   * With live sign-in, KYC and CDS come from the investor service; bid submission and
   * reconciliation are still sample data until the auction and settlement services
   * serve them.
   */
  /**
   * Each part loads only for a role that may see it, and independently: a treasury
   * officer has no KYC queue, and that must not stop their reconciliation loading.
   */
  async function load() {
    const session = useSessionStore();
    const kycAllowed = !LIVE_AUTH || session.can('kyc:review');
    const [o, k, b, r, c] = await Promise.allSettled([
      api.opsOverview(),
      kycAllowed ? (LIVE_AUTH ? backofficeApi.kycCases() : api.kycCases()) : Promise.resolve([]),
      LIVE_AUTH ? (session.can('bid:read:all') ? submissionApi.batches() : Promise.resolve([])) : api.batches(),
      api.reconciliation(),
      LIVE_AUTH && session.can('cds:open') ? backofficeApi.cdsTasks() : Promise.resolve([]),
    ]);
    if (o.status === 'fulfilled') overview.value = o.value;
    if (k.status === 'fulfilled') kyc.value = k.value;
    if (b.status === 'fulfilled') batches.value = b.value;
    if (r.status === 'fulfilled') recon.value = r.value;
    if (c.status === 'fulfilled') cdsTasks.value = c.value;
    loaded.value = true;
  }

  const actor = () => useSessionStore().user;

  async function actOnKyc(caseId: string, action: KycAction, note?: string) {
    if (!LIVE_AUTH) {
      const updated = await api.actOnKyc(caseId, action, actor());
      kyc.value = kyc.value.map((k) => (k.id === updated.id ? updated : k));
      return;
    }
    try {
      const updated = await backofficeApi.actOnKyc(caseId, action, note);
      kyc.value = kyc.value.map((k) => (k.id === updated.id ? updated : k));
    } finally {
      // Someone else may have acted; approvals also raise CDS tasks.
      await refreshLive();
    }
  }

  async function completeCds(reference: string, cdsAccount: string) {
    const result = await backofficeApi.completeCds(reference, cdsAccount);
    cdsTasks.value = await backofficeApi.cdsTasks();
    return result;
  }

  async function refreshLive() {
    const [k, c] = await Promise.all([
      useSessionStore().can('kyc:review') ? backofficeApi.kycCases() : Promise.resolve([]),
      useSessionStore().can('cds:open') ? backofficeApi.cdsTasks() : Promise.resolve([]),
    ]);
    kyc.value = k;
    cdsTasks.value = c;
  }

  function reset() {
    loaded.value = false;
    kyc.value = [];
    cdsTasks.value = [];
  }

  async function refreshBatches() {
    if (LIVE_AUTH) {
      batches.value = await submissionApi.batches();
      return;
    }
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
    if (LIVE_AUTH) await submissionApi.prepare(batchId);
    else await api.prepareBatch(batchId, actor());
    await refreshBatches();
  }

  /** Live: the checker's password confirms the approval (development stand-in). */
  async function approveBatch(batchId: string, password?: string) {
    if (LIVE_AUTH) await submissionApi.approve(batchId, password ?? '');
    else await api.approveBatch(batchId, actor());
    await refreshBatches();
    if (!LIVE_AUTH) watchSubmissions();
  }

  async function closeBidding(isin: string, reason: string) {
    await submissionApi.closeBidding(isin, reason);
    await refreshBatches();
  }

  async function resubmitBatch(batchId: string) {
    await submissionApi.resubmit(batchId);
    await refreshBatches();
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
    cdsTasks,
    load,
    reset,
    refreshLive,
    actOnKyc,
    completeCds,
    prepareBatch,
    approveBatch,
    closeBidding,
    resubmitBatch,
    refreshBatches,
    resolveBreak,
  };
});

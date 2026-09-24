import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { accountApi, type IndividualProfile, type Me, type Onboarding, type Tokens } from '../api/live/account';
import { backofficeApi } from '../api/live/backoffice';
import { useTokens } from '../api/live/http';

const REFRESH_KEY = 'govsec.refresh';

/**
 * The signed-in investor, against the live identity and investor services.
 *
 * The access token lives only in memory. The refresh token is kept in sessionStorage
 * so a page reload does not sign the customer out, and it dies with the tab. That is
 * readable by script on this origin; behind TCB's gateway it moves to an HttpOnly
 * cookie, which script cannot read at all.
 */
export const useAccountStore = defineStore('account', () => {
  const accessToken = ref<string | null>(null);
  const me = shallowRef<Me | null>(null);
  const onboarding = shallowRef<Onboarding | null>(null);
  const restored = ref(false);

  const signedIn = computed(() => accessToken.value !== null);
  /** Known once `me` has loaded; the portal a session may use follows from it. */
  const isStaff = computed(() => !!me.value && me.value.role !== 'investor');
  const isInvestor = computed(() => me.value?.role === 'investor');
  const displayName = computed(() => {
    if (me.value?.displayName) return me.value.displayName;
    const p = onboarding.value?.profile;
    return p ? `${p.firstName} ${p.lastName}` : (me.value?.phoneNumber ?? '');
  });

  let refreshing: Promise<boolean> | null = null;

  useTokens({
    accessToken: () => accessToken.value,
    refresh: () => (refreshing ??= doRefresh().finally(() => (refreshing = null))),
  });

  async function doRefresh(): Promise<boolean> {
    const stored = readRefresh();
    if (!stored) return false;
    try {
      accept(await accountApi.refresh(stored));
      return true;
    } catch {
      clear();
      return false;
    }
  }

  function accept(tokens: Tokens): void {
    accessToken.value = tokens.accessToken;
    writeRefresh(tokens.refreshToken);
  }

  function clear(): void {
    accessToken.value = null;
    me.value = null;
    onboarding.value = null;
    writeRefresh(null);
  }

  /** On page load: resume the session if this tab still has one. */
  async function restore(): Promise<void> {
    if (restored.value) return;
    if (!accessToken.value && (await doRefresh())) await load();
    restored.value = true;
  }

  async function load(): Promise<void> {
    const profile = await accountApi.me();
    me.value = profile;
    // Staff have no investor record; asking for one would only be refused.
    onboarding.value = profile.role === 'investor' ? await accountApi.onboarding() : null;
  }

  /** Development staff sign-in; production staff use TCB's directory. */
  async function staffSignIn(username: string, password: string): Promise<void> {
    accept(await backofficeApi.signIn(username, password));
    await load();
  }

  async function signIn(phoneNumber: string, pin: string): Promise<void> {
    accept(await accountApi.signIn(phoneNumber, pin));
    await load();
  }

  /** After the registration code: signed in, with no PIN yet. */
  async function completeRegistration(phoneNumber: string, code: string): Promise<{ pinSet: boolean }> {
    const tokens = await accountApi.verifyRegistration(phoneNumber, code);
    accept(tokens);
    return { pinSet: tokens.pinSet };
  }

  async function setPin(pin: string): Promise<void> {
    await accountApi.setPin(pin);
    await load();
  }

  async function completePinReset(phoneNumber: string, code: string, newPin: string): Promise<void> {
    accept(await accountApi.completePinReset(phoneNumber, code, newPin));
    await load();
  }

  async function saveProfile(profile: IndividualProfile): Promise<void> {
    onboarding.value = await accountApi.saveProfile(profile);
  }

  async function submit(consents: Parameters<typeof accountApi.submit>[0]): Promise<void> {
    onboarding.value = await accountApi.submit(consents);
  }

  async function refreshStatus(): Promise<void> {
    onboarding.value = await accountApi.onboarding();
  }

  async function signOut(): Promise<void> {
    try {
      if (accessToken.value) await accountApi.signOut();
    } finally {
      clear();
    }
  }

  return {
    accessToken,
    me,
    onboarding,
    restored,
    signedIn,
    isStaff,
    isInvestor,
    displayName,
    restore,
    load,
    signIn,
    staffSignIn,
    completeRegistration,
    setPin,
    completePinReset,
    saveProfile,
    submit,
    refreshStatus,
    signOut,
  };
});

function readRefresh(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefresh(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage blocked: the session simply ends on reload.
  }
}

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DEMO, HAS_INVESTOR, HAS_STAFF, LIVE_AUTH } from '../config/portal';
import { useAccountStore } from '../stores/account';
import type { StaffPersona } from '../config/personas';
import { useOperationsStore } from '../stores/operations';
import { useSessionStore, type Portal } from '../stores/session';
import BrandBars from './BrandBars.vue';
import NavIcon, { type IconName } from './NavIcon.vue';
import SegmentedControl from './SegmentedControl.vue';

const session = useSessionStore();
const ops = useOperationsStore();
const route = useRoute();
const router = useRouter();
const account = useAccountStore();

const canSignOut = computed(() => LIVE_AUTH && account.signedIn);
async function signOut() {
  const staff = isStaff.value;
  await account.signOut();
  await router.replace({ name: staff ? 'staff-sign-in' : 'account-sign-in' });
}

const isStaff = computed(() => session.portal === 'staff');

/** Nav items come from route meta, filtered by portal and by the user's permissions. */
const nav = computed(() =>
  router
    .getRoutes()
    .filter((r) => r.meta.nav && r.meta.portal === session.portal)
    .filter((r) => !r.meta.permission || session.can(r.meta.permission))
    .sort((a, b) => (a.meta.nav?.order ?? 0) - (b.meta.nav?.order ?? 0))
    .map((r) => ({
      name: r.name as string,
      label: r.meta.nav?.label ?? '',
      icon: r.meta.nav?.icon as IconName,
      badge: badgeFor(r.name as string),
      active: route.name === r.name || route.meta.navParent === r.name,
    })),
);

function badgeFor(name: string): number | null {
  if (!ops.loaded) return null;
  if (name === 'staff-kyc') {
    const open = ops.kyc.filter((k) =>
      ['New', 'Returned', 'Awaiting checker', 'Info requested'].includes(k.status),
    ).length;
    return open || null;
  }
  if (name === 'staff-recon') {
    return ops.recon?.rows.filter((r) => r.result === 'Break').length || null;
  }
  return null;
}

const portalOptions = [
  { value: 'investor' as Portal, label: 'Investor portal' },
  { value: 'staff' as Portal, label: 'Back-office' },
];
const personaOptions = [
  { value: 'maker' as StaffPersona, label: 'Maker' },
  { value: 'checker' as StaffPersona, label: 'Checker' },
  { value: 'treasury' as StaffPersona, label: 'Treasury' },
];

const portalModel = computed({
  get: () => session.portal,
  set: (next: Portal) => {
    session.setPortal(next);
    void router.push({ name: next === 'staff' ? 'staff-overview' : 'investor-dashboard' });
  },
});

const personaModel = computed({
  get: () => session.staffPersona,
  set: (next: StaffPersona) => {
    session.actAs(next);
    // A persona may not be allowed on the current screen; the guard sends them home.
    void router.replace({ name: route.name ?? 'staff-overview' });
  },
});

const showPortalSwitch = DEMO && HAS_INVESTOR && HAS_STAFF;
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo-plate">
          <div class="logo-crop">
            <img src="/tcb-logo.png" alt="Tanzania Commercial Bank" />
          </div>
        </div>
        <div class="product">
          <div class="product-kicker">Government Securities</div>
          <div class="product-name">
            <BrandBars />{{ isStaff ? 'Back-office' : 'Investor portal' }}
          </div>
        </div>
      </div>

      <nav class="nav" aria-label="Main">
        <RouterLink
          v-for="item in nav"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav-item"
          :class="{ 'nav-item--active': item.active }"
          :aria-current="item.active ? 'page' : undefined"
        >
          <span class="nav-label"><NavIcon :name="item.icon" />{{ item.label }}</span>
          <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
        </RouterLink>
      </nav>

      <div class="user">
        <div class="avatar" aria-hidden="true">{{ session.user.initials }}</div>
        <div class="user-text">
          <div class="user-name">{{ session.user.name }}</div>
          <div class="user-role">{{ session.user.roleLabel }}</div>
        </div>
        <button v-if="canSignOut" type="button" class="sign-out" @click="signOut">Sign out</button>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <div class="crumb">{{ isStaff ? 'TCB Back-office' : 'TCB Investor portal' }}</div>
          <h1 class="title">{{ route.meta.title }}</h1>
        </div>
        <div v-if="DEMO" class="demo-controls">
          <div v-if="isStaff && !LIVE_AUTH" class="acting">
            <span class="acting-label">Acting as</span>
            <SegmentedControl v-model="personaModel" :options="personaOptions" label="Acting as" />
          </div>
          <SegmentedControl
            v-if="showPortalSwitch"
            v-model="portalModel"
            :options="portalOptions"
            label="Portal"
          />
        </div>
      </header>

      <div class="content">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  background: var(--navy);
  color: var(--on-navy);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 8px;
}
/* The logo file is square with generous margins; the design crops to the wordmark. */
.logo-plate {
  width: 204px;
  height: 87px;
  overflow: hidden;
  position: relative;
  background: #fff;
  border-radius: 8px;
  margin-left: -8px;
}
.logo-crop {
  position: absolute;
  left: 12px;
  top: 10px;
  width: 180px;
  height: 67px;
  overflow: hidden;
}
.logo-crop img {
  position: absolute;
  width: 200px;
  height: 200px;
  left: -10px;
  top: -67px;
  max-width: none;
}
.product {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.product-kicker {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--on-navy-faint);
}
.product-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--on-navy-muted);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.nav-item--active {
  background: var(--navy-raised);
  color: var(--brand-yellow);
}
.nav-item:focus-visible {
  outline-color: var(--brand-yellow);
}
.nav-label {
  display: flex;
  align-items: center;
  gap: 12px;
}
.nav-label svg {
  flex: none;
  opacity: 0.9;
}
.nav-badge {
  font-size: 12px;
  background: var(--brand-yellow);
  color: var(--navy);
  border-radius: 10px;
  padding: 1px 8px;
  font-weight: 600;
}

.user {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px;
  border-top: 1px solid var(--navy-raised);
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--navy-raised);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
}
.user-text {
  min-width: 0;
  flex: 1;
}
.sign-out {
  background: none;
  border: 1px solid var(--navy-raised);
  color: var(--on-navy-muted);
  border-radius: var(--radius-control);
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}
.sign-out:hover {
  color: var(--on-navy);
}
.user-name {
  font-size: 13px;
  font-weight: 500;
}
.user-role {
  font-size: 12px;
  color: var(--on-navy-faint);
}

.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--border);
  background: #fff;
  flex-wrap: wrap;
}
.crumb {
  font-size: 12px;
  color: var(--muted);
}
.title {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
}
.demo-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.acting {
  display: flex;
  align-items: center;
  gap: 8px;
}
.acting-label {
  font-size: 12px;
  color: var(--muted);
}
.content {
  padding: 28px 32px 56px;
  max-width: var(--content-max);
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Narrow screens: the sidebar becomes a header band rather than squeezing the content. */
@media (max-width: 900px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }
  .sidebar {
    position: static;
    height: auto;
    gap: 16px;
  }
  .nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .user {
    display: none;
  }
  .topbar,
  .content {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>

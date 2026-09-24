<script setup lang="ts">
import BrandBars from './BrandBars.vue';

/** Sign-in, registration and PIN reset: the brand panel beside one focused card. */
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="auth">
    <aside class="panel">
      <div class="logo-plate">
        <div class="logo-crop">
          <img src="/tcb-logo.png" alt="Tanzania Commercial Bank" />
        </div>
      </div>
      <div class="pitch">
        <div class="kicker"><BrandBars />Government Securities</div>
        <p class="headline">Treasury bills and bonds, bought through TCB.</p>
        <p class="sub">
          Bid in Bank of Tanzania auctions from your phone or computer. Funds are held on your
          TCB account until the auction result is known.
        </p>
      </div>
      <p class="help">Help: <a href="tel:0800780100">0800 780 100</a> (free)</p>
    </aside>

    <main class="side">
      <section class="card auth-card">
        <header class="auth-head">
          <h1 class="auth-title">{{ title }}</h1>
          <p v-if="subtitle" class="auth-sub">{{ subtitle }}</p>
        </header>
        <slot />
      </section>
      <nav v-if="$slots.footer" class="auth-footer"><slot name="footer" /></nav>
    </main>
  </div>
</template>

<style scoped>
.auth {
  display: grid;
  grid-template-columns: minmax(320px, 440px) minmax(0, 1fr);
  min-height: 100vh;
}
.panel {
  background: var(--navy);
  color: var(--on-navy);
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}
.logo-plate {
  width: 204px;
  height: 87px;
  overflow: hidden;
  position: relative;
  background: #fff;
  border-radius: 8px;
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
.kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--on-navy-faint);
}
.headline {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.25;
  margin: 14px 0 12px;
  text-wrap: balance;
}
.sub {
  color: var(--on-navy-muted);
  font-size: 15px;
  line-height: 1.5;
  margin: 0;
  text-wrap: pretty;
}
.help {
  margin: auto 0 0;
  font-size: 13px;
  color: var(--on-navy-faint);
}
.help a {
  color: var(--brand-yellow);
}

.side {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 20px;
}
.auth-card {
  width: 100%;
  max-width: 460px;
  padding: 28px;
}
.auth-head {
  margin-bottom: 22px;
}
.auth-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.auth-sub {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.45;
  text-wrap: pretty;
}
.auth-footer {
  font-size: 14px;
  color: var(--muted);
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}

@media (max-width: 860px) {
  .auth {
    grid-template-columns: minmax(0, 1fr);
    /* The band keeps its own height; the form takes the rest. */
    grid-template-rows: auto 1fr;
  }
  .panel {
    padding: 16px;
    gap: 12px;
    flex-direction: row;
    align-items: center;
  }
  .logo-plate {
    transform: scale(0.7);
    transform-origin: left center;
    margin: -13px -61px -13px 0;
  }
  .pitch .headline,
  .pitch .sub,
  .help {
    display: none;
  }
  .side {
    justify-content: flex-start;
    padding: 24px 16px;
  }
  .auth-card {
    padding: 20px;
  }
}
</style>

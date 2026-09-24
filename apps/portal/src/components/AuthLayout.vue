<script setup lang="ts">
import { DEMO } from '../config/portal';
import BrandBars from './BrandBars.vue';

/**
 * Sign-in, registration and PIN reset.
 *
 * A brand panel beside a plain white form column. The panel's graphic is TCB's own
 * mark (the square frame in yellow, green and blue) drawn large, so the page is
 * recognisably TCB without a photograph that would need licensing.
 */
const props = withDefaults(
  defineProps<{ title: string; subtitle?: string; audience?: 'investor' | 'staff' }>(),
  { subtitle: undefined, audience: 'investor' },
);

const copy =
  props.audience === 'staff'
    ? {
        headline: 'Back-office',
        sub: 'KYC review, CDS accounts, bid submission to the Bank of Tanzania and settlement.',
        points: [
          'Maker-checker on every approval',
          'Every action recorded against your name',
          'For TCB staff on the bank network only',
        ],
        help: 'Access problems: TCB ICT service desk',
      }
    : {
        headline: 'Treasury bills and bonds, bought through TCB.',
        sub: 'Bid in Bank of Tanzania auctions from your phone or computer.',
        points: [
          'Held in your own CDS account at the Bank of Tanzania',
          'Funds stay on your TCB account until the result',
          'Results and payments by SMS',
        ],
        help: null,
      };
const year = new Date().getFullYear();
</script>

<template>
  <div class="auth">
    <aside class="panel">
      <div class="pitch">
        <svg class="mark" viewBox="0 0 200 200" aria-hidden="true">
          <polygon class="y" points="0,0 64,0 100,36 36,36 36,150 0,186" />
          <polygon class="g" points="92,0 200,0 200,84 164,48 164,36 128,36" />
          <polygon class="b" points="164,76 200,112 200,200 12,200 48,164 164,164" />
        </svg>
        <div class="kicker"><BrandBars />Government Securities</div>
        <h2 class="headline">{{ copy.headline }}</h2>
        <p class="sub">{{ copy.sub }}</p>
        <ul class="points">
          <li v-for="point in copy.points" :key="point">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
            {{ point }}
          </li>
        </ul>
      </div>
      <p class="legal">© {{ year }} Tanzania Commercial Bank PLC. Regulated by the Bank of Tanzania.</p>
    </aside>

    <main class="side">
      <div class="column">
        <div class="logo" role="img" aria-label="Tanzania Commercial Bank">
          <img src="/tcb-logo.png" alt="" />
        </div>

        <header class="head">
          <h1 class="title">{{ title }}</h1>
          <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
        </header>

        <slot />

        <footer class="foot">
          <nav v-if="$slots.footer" class="links"><slot name="footer" /></nav>
          <p class="help">
            <template v-if="copy.help">{{ copy.help }}</template>
            <template v-else>Help: <a href="tel:0800780100">0800 780 100</a>, free from any network</template>
          </p>
        </footer>

        <div v-if="DEMO && $slots.dev" class="dev">
          <slot name="dev" />
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth {
  display: grid;
  grid-template-columns: minmax(360px, 5fr) 7fr;
  min-height: 100vh;
  background: var(--surface);
}

/* ---------- brand panel ---------- */

.panel {
  position: relative;
  overflow: hidden;
  background: var(--navy);
  color: var(--on-navy);
  padding: 48px 56px 32px;
  display: flex;
  flex-direction: column;
}
/* Auto margins centre the group in whatever height is left above the legal line, and
   push that line to the bottom: the two can never overlap, however short the screen. */
.pitch {
  margin: auto 0;
}
/* The mark, whole and above the text it introduces: one group, centred in the panel,
   so there is no empty band. Kept well below the logo's visual weight on the right. */
.mark {
  display: block;
  width: min(40%, 180px);
  margin-bottom: 36px;
}
.mark .y {
  fill: var(--brand-yellow);
}
.mark .g {
  fill: var(--brand-green);
}
.mark .b {
  fill: var(--brand-blue);
}
.pitch {
  position: relative;
  max-width: 440px;
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
  font-size: 34px;
  font-weight: 600;
  line-height: 1.18;
  margin: 16px 0 12px;
  text-wrap: balance;
}
.sub {
  color: var(--on-navy-muted);
  font-size: 16px;
  line-height: 1.5;
  margin: 0 0 28px;
  text-wrap: pretty;
}
.points {
  list-style: none;
  margin: 0;
  padding: 24px 0 0;
  border-top: 1px solid var(--navy-raised);
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  color: var(--on-navy);
}
.points li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.points svg {
  width: 20px;
  height: 20px;
  flex: none;
  fill: none;
  stroke: var(--brand-green);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.legal {
  margin: 32px 0 0;
  font-size: 12px;
  color: var(--on-navy-faint);
}

/* ---------- form column ---------- */

.side {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 48px 32px;
}
.column {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
}
/* The logo file is square with generous margins; crop to the lock-up. */
.logo {
  width: 180px;
  height: 67px;
  overflow: hidden;
  position: relative;
  margin: 0 0 40px -2px;
}
.logo img {
  position: absolute;
  width: 200px;
  height: 200px;
  left: -10px;
  top: -67px;
  max-width: none;
}
.head {
  margin-bottom: 28px;
}
.title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.subtitle {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.5;
  text-wrap: pretty;
}
.foot {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14px;
}
.links {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
.links :deep(a) {
  color: var(--navy);
  font-weight: 600;
}
.help {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.help a {
  color: var(--navy);
}
.dev {
  margin-top: 28px;
}

/* Short screens (a 768px-tall laptop): the mark gives way before the text does. */
@media (max-height: 820px) and (min-width: 961px) {
  .mark {
    width: min(30%, 120px);
    margin-bottom: 24px;
  }
  .headline {
    font-size: 28px;
  }
}

/* ---------- narrow screens ---------- */

@media (max-width: 960px) {
  .auth {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
  }
  .panel {
    min-height: 0;
    padding: 20px 20px 18px;
  }
  /* A slice of the frame reads as a stray bar at this size; the kicker's brand bars
     carry the colours instead. */
  .mark {
    display: none;
  }
  .headline {
    font-size: 20px;
    margin: 8px 0 0;
    max-width: 70%;
  }
  .sub,
  .points,
  .legal {
    display: none;
  }
  .side {
    align-items: flex-start;
    padding: 28px 20px 40px;
  }
  .logo {
    display: none;
  }
}
</style>

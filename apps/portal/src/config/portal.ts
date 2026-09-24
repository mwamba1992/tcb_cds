/**
 * What this build contains.
 *
 * `import.meta.env.VITE_PORTAL` is replaced with a literal at build time, so in the
 * investor build `HAS_STAFF` is the constant `false` and every staff route — and the
 * code behind it — is removed from the bundle, not merely hidden. The public site never
 * ships back-office screens (design review, point 5).
 */
export const PORTAL = import.meta.env.VITE_PORTAL ?? 'all';
export const HAS_INVESTOR = PORTAL !== 'staff';
export const HAS_STAFF = PORTAL !== 'investor';

/** Demo controls. Off in both production builds. */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

/**
 * Investor sign-in, registration and onboarding talk to the real services (through the
 * dev server's proxy, or the gateway in production). The rest of the investor portal
 * and all of the back-office are still mocked. The offline demo build leaves this off.
 */
export const LIVE_AUTH = import.meta.env.VITE_AUTH === 'live';

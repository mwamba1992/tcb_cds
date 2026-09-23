/**
 * Fixed values from the Bank of Tanzania Government Securities Bidding Process &
 * Authentication API, BOT-SPEC-GSS-2026-v1.0 (TAD reference R2).
 *
 * Anything here that BoT may change without a new specification version belongs in
 * settings instead. These are the values the specification itself states.
 */

export const BOT_GATEWAYS = {
  /** Public internet or VPN. Simulation, integration and UAT. */
  sandbox: 'https://proxy-sandbox.bot.go.tz',
  /** BoT Secure Financial WAN only, from pre-registered static IPs. */
  production: 'https://proxy.bot.go.tz',
} as const;

export type BotEnvironment = keyof typeof BOT_GATEWAYS;

/** BoT rejects a request whose x-timestamp is older than this (spec §2.1). */
export const BOT_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Lifetime of the JWT issued by POST /api/auth (spec §4.2). */
export const BOT_TOKEN_LIFETIME_SECONDS = 43_200;

/**
 * Minimum amount per bid, in whole shillings (spec §6, POST /bids 400 response).
 * Enforced at capture time as well, so an investor learns it before BoT does.
 */
export const BOT_MIN_BID_TZS = 500_000n;

export const BOT_PATHS = {
  auth: '/api/auth',
  auctions: '/auctions',
  bids: (batchReference: string) => `/bids/${encodeURIComponent(batchReference)}`,
  bidsByIsin: (isin: string) => `/bids/${encodeURIComponent(isin)}`,
  bid: (isin: string, reference: string) =>
    `/bids/${encodeURIComponent(isin)}/${encodeURIComponent(reference)}`,
  winners: (isin: string) => `/winners/${encodeURIComponent(isin)}`,
} as const;

# GovSec Platform — Tanzania Commercial Bank

Digital platform for the acquisition of Government securities (Treasury Bills and
Treasury Bonds): investor onboarding, bidding, allocation, settlement, holdings,
coupons and redemptions. Integrates with TCB Core Banking and the Bank of Tanzania GSS
API.

This repository implements [`docs/TCB_GovSec_Platform_Technical_Architecture.docx`](docs/TCB_GovSec_Platform_Technical_Architecture.docx), called
**TAD** throughout the code with section numbers. Contract TR222/2024/2025/C/43.

See [STATUS.md](STATUS.md) for where the build stands.

## Stack

The stack is carried over from sokohub, which the team already builds and supports.

| Layer              | Choice                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| Monorepo           | Nx 23, TypeScript 6, Node 22                                                       |
| Services           | NestJS 11, one PostgreSQL schema per service, Prisma 7                             |
| Messaging          | RabbitMQ 4 (quorum queues) with a transactional outbox                             |
| Money              | `@govsec/money`: bigint minor units; amounts are strings on the wire, never floats |
| Web portal (later) | Vue 3 + Vite + Pinia; one codebase with investor, back-office and BoT areas        |

## Deviations from the TAD

These were agreed before building, and are recorded here so that a reader of the TAD
can tell a deliberate difference from a mistake.

| TAD says                        | We build                                                 | Why                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kafka (§7.5)                    | **RabbitMQ**                                             | Simpler to operate, and well within its capacity at auction volumes. The cost is that **there is no event replay**: every read model and reconciliation job must backfill from the owning service's database. |
| Java / Spring Boot (§14)        | **NestJS / TypeScript**                                  | One language across services and the web portal; the team supports the platform after handover.                                                                                                               |
| Camunda BPMN/DMN (§4.3, ADR-05) | **Explicit state machines in Postgres + scheduled jobs** | Easier to audit and test. Cut-off timers follow the same pattern as other scheduled jobs. Rules stay configuration via `@govsec/settings`.                                                                    |
| Keycloak (§14)                  | **Own identity service, RS256**                          | Staff sign-in federates with TCB's directory.                                                                                                                                                                 |

## Layout

```
apps/
  identity/        Identity & access            :3101   TAD §10.1
  investor/        Investor, KYC, CDS accounts  :3102   TAD §4.2, §5.1
  auction/         Auctions, bids, batches      :3103   TAD §5.2, §5.7
  bot-gateway/     Bank of Tanzania GSS API     :3104   TAD §7.3
  cbs-gateway/     TCB Core Banking             :3105   TAD §7.2
  settlement/      Holds, settlement, recon     :3106   TAD §5.4, §7.4
  notification/    SMS, email, push             :3107   TAD §4.2
  bot-simulator/   Fake BoT GSS API (dev only)  :3199
  portal/          Vue investor + back-office   :4400
    prisma/        schema + migrations; each service owns one Postgres schema
libs/
  money/           Money as bigint minor units. Never a float.
  events/          RabbitMQ topology and the event envelope
  outbox/          Transactional outbox relay
  auth/            Token claims, roles, permissions, guards (maker-checker)
  settings/        Operator-tunable values with bounds and audit
  notify/          Direct notification client for sensitive messages
  reference/       Human-readable, checksummed references (BD-, ST-, PY-, …)
  pagination/      Keyset pagination contract
  bot-client/      BoT signing, wire types, batch references, amount conversion
  bot-simulator/   Local stand-in for BoT's GSS API (development and tests only)
```

### The BoT boundary

Only `bot-gateway` talks to the Bank of Tanzania. `libs/bot-client` holds the request
signer and BoT's wire types, and lint forbids every other project from importing it.
Other services learn what BoT said through events on the `govsec.bot` exchange, in our
vocabulary. Weakening that rule in `eslint.config.mjs` changes the security model.

## Getting started

```bash
nvm use                       # Node 22
npm ci
cp .env.example .env          # development values; never commit .env

# Postgres + RabbitMQ: either Homebrew services, or
docker compose up -d

# First time only, if you use Homebrew Postgres rather than docker compose:
psql -d postgres -c "CREATE ROLE govsec LOGIN PASSWORD 'govsec'" \
                 -c "CREATE DATABASE govsec_dev OWNER govsec"
PGPASSWORD=govsec psql -h localhost -U govsec -d govsec_dev -f scripts/init-schemas.sql

# Generate clients and apply migrations for every service
for s in identity investor auction bot-gateway cbs-gateway settlement notification; do
  npx nx run $s:prisma-generate && npx nx run $s:prisma-migrate
done

npx nx serve auction           # http://localhost:3103/docs for Swagger
```

## Working with BoT locally

BoT has not issued sandbox credentials yet, so development runs against a simulator of
its GSS API (`libs/bot-simulator`). It follows BOT-SPEC-GSS-2026-v1.0, gaps included: auctions
carry no cut-off time (B4), there is no cancel endpoint (B3), and `/winners` does not say
whose allotment is whose (B1). Allotments are therefore matched to our bids by the
`requestId` in BoT's callbacks.

```bash
./scripts/dev-bot-keys.sh        # once: RSA keys for TCB and the simulator, into secrets/
npx nx serve bot-simulator       # fake BoT on :3199
npx nx serve bot-gateway         # signs in, syncs auctions, receives callbacks

# Run an auction and watch the callbacks arrive:
curl -X POST localhost:3199/_sim/close -H 'content-type: application/json' \
     -d '{"isin":"TZ1996104321","cutoffPrice":"88.00"}'
curl localhost:3199/_sim/state
```

When BoT issues sandbox credentials: put TCB's key pair and BoT's public key in the
paths `.env` names, set the `BOT_*` values BoT issues, and remove `BOT_BASE_URL`.
No code changes.

## Everyday commands

```bash
npx nx run-many -t lint test typecheck build --all
npx nx affected -t test        # only what your branch changed
npx nx graph                   # project dependency graph
```

## Security notes

- `.env`, `*.pem` and `secrets/` are gitignored. BoT API keys and RSA keys belong in
  Vault or the HSM in every shared environment, never in the repository.
- Development uses HS256 tokens. Every service refuses to boot in production unless
  `JWT_ALGORITHM=RS256`, and refuses development placeholder secrets.
- Guards deny by default: an endpoint is protected unless it is explicitly `@Public()`.

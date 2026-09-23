# GovSec — Project Status

**Last updated:** 2026-09-23 · **Current milestone:** M0 (workspace) · **Next:** BoT sandbox connection in bot-gateway

## At a glance

|                     |                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Services scaffolded | **7 of 7**: identity, investor, auction, bot-gateway, cbs-gateway, settlement, notification |
| Shared libraries    | 9: money, events, outbox, auth, settings, notify, reference, pagination, bot-client         |
| Domain endpoints    | 0 (health and readiness only)                                                               |
| Unit tests          | 80, all passing                                                                             |
| Migrations          | 7 (one initial migration per service schema)                                                |
| CI                  | lint · test · typecheck · build, against real Postgres and RabbitMQ                         |

Every service builds, boots, connects to its own schema and to RabbitMQ, and answers
`/healthz` and `/readyz`.

## Milestones (13 weeks)

|        | Milestone                                                                     | Weeks | Status                                            |
| ------ | ----------------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| **M0** | Workspace, shared libraries, CI; BoT sandbox sign-in and signing proven       | 1     | 🟡 Workspace done; sandbox pending BoT onboarding |
| **M1** | identity, investor/KYC, auction catalogue from BoT, cbs-gateway stub          | 2–4   | ⬜                                                |
| **M2** | Bidding, funds holds, batch submission to BoT sandbox, callbacks and winners  | 4–7   | ⬜                                                |
| **M3** | settlement, reconciliation, notification; web portal (investor + back-office) | 6–9   | ⬜                                                |
| **M4** | SIT with live Core Banking and BoT sandbox mock auction; pen test; UAT        | 10–12 | ⬜                                                |
| **M5** | Pilot go-live and hypercare                                                   | 13    | ⬜                                                |

## Suggested ownership

| Developer       | Services                                                       |
| --------------- | -------------------------------------------------------------- |
| Lead            | auction, settlement (the money core)                           |
| Ismail          | bot-gateway, cbs-gateway (integrations; BoT sandbox risk)      |
| Third developer | identity, investor, notification (largely ported from sokohub) |

## Blocked on others

| Item                                                                                                                            | Owner              | Needed for            |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------- |
| BoT onboarding: RSA key exchange, API key, interface and sender codes, participant code, IP allow-list                          | TCB ICT + BoT      | M0 sandbox connection |
| Answers to the BoT API clarifications (TAD Appendix B), especially B1 winners without account, B3 cancellation, B4 cut-off time | BoT                | M2                    |
| Core Banking API specification and test environment; confirmation of lien/hold support                                          | TCB ICT            | M1 stub → M4 live     |
| Settlement mechanism to BoT (TISS aggregate vs GePG)                                                                            | TCB Treasury + BoT | M3                    |
| Production hosting target (Kubernetes/OpenShift or VMs)                                                                         | TCB ICT            | Deployment packaging  |

## Next up (M0 → M1)

1. `bot-gateway`: token manager for `POST /api/auth`, a signed HTTP client using
   `@govsec/bot-client`, `GET /auctions` against the sandbox, and a callback receiver
   with raw-body signature verification.
2. `auction`: catalogue model and migration; consume `bot.auction.*` events.
3. `identity`: port investor OTP/PIN and staff sign-in from sokohub.

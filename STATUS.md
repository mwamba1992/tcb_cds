# GovSec — Project Status

**Last updated:** 2026-09-24 · **Current milestone:** M0 → M1 · **Next:** portal registration and sign-in screens on the real API (registration journey, part 4)

## At a glance

|                     |                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Services scaffolded | **7 of 7**: identity, investor, auction, bot-gateway, cbs-gateway, settlement, notification |
| Shared libraries    | 9: money, events, outbox, auth, settings, notify, reference, pagination, bot-client         |
| Domain endpoints    | bot-gateway, notification, identity, investor (onboarding, KYC, CDS), cbs-gateway (stub)    |
| Unit tests          | 194, all passing                                                                            |
| Migrations          | 13                                                                                          |
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

## identity (investor sign-up and sign-in)

- Register: phone number → SMS code → account created and signed in → 4-digit PIN.
  Accepts 0712…, 255712… and +255712…; stores E.164. No password: the PIN is the
  knowledge factor, the phone the possession factor.
- Sign in with phone + PIN. An unknown number and a wrong PIN answer identically, in
  the same time.
- Lockout after 5 wrong PINs (sign-in, step-up and PIN change count together):
  sessions revoked, lifted only by a PIN reset with an SMS code. The attempt is
  reserved before the PIN is compared, so 20 parallel guesses evaluate exactly 5.
- PINs refused when repeated, sequential or common. Argon2id for PINs and codes.
- SMS throttle per number: one code per 60 s, five per hour.
- Refresh-token rotation; replay of a rotated token revokes every session and emits
  `identity.login.suspicious`. Access 15 min, refresh 12 h.
- Step-up: PIN → `pin_token` scoped to one permission and an optional TZS ceiling;
  redeemed once by the performing service (`POST /internal/v1/step-up/redeem`).
- Events on `govsec.identity`: account created, PIN set, account locked, login
  suspicious. No phone numbers or credentials in any payload.
- Development: `OTP_FIXED_CODE=123456` (refused in production).
- Not yet: staff sign-in (next round, with the back-office KYC screen), device binding.

## investor + cbs-gateway (onboarding and KYC)

- Individual investors: details → consents (versioned) → submit. The model carries
  `type` for corporate, joint and minor investors, which add a profile table each.
- At submission: NIDA check (declared vs registry), Core Banking check (NIDA vs CBS
  record, account ownership), sanctions and PEP screening, then a risk rating with
  its reasons. All clear and low risk → approved straight through; anything else →
  a KYC case. An unreachable source is never treated as clear.
- One NIDA number, one investor.
- KYC queue with maker-checker: officer approves / requests info / rejects;
  a *different* supervisor or compliance officer confirms or returns. Proven live,
  including a compliance officer refused on their own recommendation.
- On approval: a CDS request for the back office (BoT has no CDS API), and for a
  new-to-bank investor an account-opening request to Core Banking; the investor
  carries on. `cbs.account.opened` links the new account. `canBid` needs KYC
  approved, CDS account recorded and a TCB account.
- CDS account numbers are unique across investors.
- SMS at each step (submitted, under review, approved, rejected, CDS open), phone
  fetched from identity at send time. `investor.*` events carry ids only.
- Stubs until TCB provides access: NIDA, sanctions/PEP lists, Core Banking
  (`NIDA_MODE`, `SCREENING_MODE`, `CBS_MODE`; production refuses all three stubs).
  Stub fixtures: Asha (clean), Juma (name held abbreviated), Grace (PEP),
  Ali (sanctions near-match); any other valid NIN is new to bank.

## bot-gateway (done against the simulator)

- Signed client for every BoT endpoint, with token renewal, retries and typed errors.
- `POST /bot/callback`: BoT's signature is checked against the raw body; each callback
  is stored exactly once, and a redelivery is only acknowledged again.
- Auction sync every 5 minutes; `bot.auction.published` / `.updated` only on change.
- `POST /internal/v1/batches/{ref}`: batch submission, callable by the auction service
  only, idempotent on the batch reference.
- Events on `govsec.bot`: auction published/updated, batch submitted, bid
  accepted/rejected/allotted/unsuccessful.
- Proven live: submission, replay, a refused caller, a refused forged callback, an
  auction close with 6 signed callbacks, and 10 events published to RabbitMQ.
- Bid query and amend for the auction service (no cancel: BoT has none, B3).
- Submission reconciliation every minute (missing, unexpected and rejected bids are
  found before cut-off) and a winners cross-check every 5 minutes (B1).
- Audit log of every BoT exchange (metadata only), a clock-skew guard from BoT's
  Date header, and BoT's link state in `/readyz`.

### bot-gateway: what only BoT or TCB can unblock

- Sandbox credentials and IP allow-list, then a test run against the real sandbox.
- BoT's answers to Appendix B (B1, B3, B5, B6 especially) and the exact `investor`
  name BoT shows for TCB on /winners (`BOT_INVESTOR_NAME`).
- TCB's HSM product, to replace the PEM signer in production.
- Retention period for `bot_request_log` (TCB records policy), then a purge job.

## Next up

1. `auction`: the bidding endpoints the portal already expects (place, withdraw,
   batches, maker-checker), and consumers of the `bot.*` events.
2. `cbs-gateway`: stub funds holds, so bids hold real (simulated) money.
3. Replace the portal's mock API with the auction endpoints as they land.

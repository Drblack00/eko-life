# Èkó Life — Fintech Foundation Plan (Milestones 1–4)

Real-money subsystem for the Èkó Life game: separate cash-backed NGN wallet +
double-entry ledger, alongside (never mixed with) the existing gameplay-coins
economy. This document covers the foundation (schema + ledger engine). Wallet
APIs, P2P transfers, withdrawals, and provider adapters follow in later turns.

## 1. Current state (inspected 2026-10-10)

- **Server**: Node ≥22, ESM JavaScript, Express 4 + `ws`. No TypeScript on the
  server — fintech code is written as plain ESM `.js` to match the repo.
- **DB**: dual adapter in `server/src/db.js` — Supabase Postgres (`pg` Pool)
  when `DATABASE_URL` is set, else local SQLite (`node:sqlite`). Access via
  `dbRun/dbGet/dbAll(sqliteSql, pgSql, params)`. Schema is inline idempotent
  `CREATE TABLE IF NOT EXISTS` blocks (`SQLITE_SCHEMA` / `PG_SCHEMA`) run by
  `initDb()` — there is no migrations folder; fintech tables follow the same
  pattern (additive only, no changes to existing tables).
- **Tests**: `node --test tests/*.test.js` from `server/` (node built-in runner).
- **Existing economy**: `characters.money` (integer) + `transactions` table
  (kind/amount/balance_after/meta) = gameplay coins. The cash wallet is a
  completely separate set of tables and code paths. **There is no conversion
  path between gameplay coins and cash** — not via transfers, gameplay,
  frontend, or admin. This is enforced by separation, not by policy text.
- **Auth**: token-based (`authMiddleware` in `server/src/auth.js`).

## 2. Technology decisions (why reuse the existing stack)

- **Stay on Express + dual SQLite/PG adapter** instead of introducing
  Prisma/TypeORM or a separate service: the adapter already handles both
  backends with one API, tests run in-memory in milliseconds, and a second
  stack would double operational surface for zero product gain.
- **Plain ESM JS, not TypeScript**: the server has no TS toolchain; adding one
  for a single subsystem would complicate builds and deploys.
- **Integer kobo everywhere** (`amount_kobo INTEGER`, CHECK ≥ 0, currency
  locked to `'NGN'`): eliminates float rounding bugs in money math.
- **Append-only ledger** (`ledger_journals` + `ledger_entries`): every naira
  movement is a balanced journal (debits == credits); corrections are
  compensating reversal journals, never edits/deletes.
- **Idempotency keys** on journals, transfers, deposits, withdrawals:
  retries and duplicate webhooks can never double-post.
- **Feature flag `CASH_OPS_ENABLED`** (env var, default `false`): every cash
  endpoint rejects with 403 while off. Live money cannot be enabled by
  accident, by frontend manipulation, or by a deploy — it requires an
  explicit env change *plus* the blockers in §4.
- **Mock provider only**: `server/src/fintech/mockProvider.js` is a stub
  interface with deterministic fake results. It is never wired to anything
  live and is clearly labeled so it cannot be mistaken for infrastructure.

## 3. Phased milestones (aligned with the master prompt)

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Inspect repo + reference; implementation plan | ✅ this doc |
| 2 | App foundation / navigation / responsive game UI | ✅ already exists (game is live) |
| 3 | Gameplay currency + core simulation | ✅ already exists (coins, jobs, needs) |
| 4 | Double-entry ledger design + tests (this turn) | 🔨 in progress |
| 5 | Cash-wallet API, history, ledger-backed balances | next turn |
| 6 | Simulated deposits + P2P transfers | after 5 |
| 7 | Withdrawal requests, 10% commission, reservations, simulated payout reconciliation | after 6 |
| 8 | Real provider adapter (sandbox creds) — **only after written provider approval** | blocked (§4) |
| 9 | Identity verification, risk controls, admin ops, reconciliation | after 7 |
| 10 | Security testing, mobile testing, docs, deployment prep | after 9 |
| 11 | Enable production financial ops — **only after all of §4** | blocked (§4) |

The application remains fully working after every milestone; cash features are
inert (403) until Milestone 11.

## 4. BLOCKERS for live money (all must clear before Milestone 11)

Nothing here is a formality — each is a hard gate:

1. **Written provider approval** (Paystack and/or Flutterwave): the full
   checklist is in `docs/PROVIDER_APPROVAL_CHECKLIST.md`. In particular we
   need explicit written confirmation that the provider permits (a) holding
   customer NGN balances, (b) peer-to-peer transfers of those balances, and
   (c) withdrawals to Nigerian bank accounts for a gaming product. A standard
   collections-only gateway account does **not** imply any of this.
2. **Business registration & KYC**: CAC-registered entity, verified
   directors, business bank account in the entity's name.
3. **Fund safeguarding / custody arrangement**: where customer naira sits
   (provider wallet vs. segregated bank account), who can move it, and the
   reconciliation cadence — documented and signed.
4. **Legal review of CBN requirements**: qualified Nigerian counsel confirms
   the model (wallet + P2P + commission) against current CBN/NDIC rules;
   written opinion kept on file.
5. **Security review**: webhook signature verification against live docs,
   secrets management (no secrets in code/env dumps), rate limits, admin
   dual-approval for adjustments, incident-response runbook.
6. **Operational readiness**: reconciliation procedure tested against sandbox
   settlements, dispute/complaint handling owner named, data-retention and
   NDPA privacy notices published.

Until then: `CASH_OPS_ENABLED=false`, mock provider only, sandbox tests only.

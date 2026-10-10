# Cash Wallet API (M5 / Milestone 6a)

Base path: `/api/cash-wallet` (mounted by the coordinator; the router factory is
`createCashWalletRouter()` in `server/src/routes/cashWallet.js`).

## Safety — read this first

- **LIVE MONEY STAYS OFF.** Every endpoint sits behind `authMiddleware` +
  `requireCashOps` (`src/fintech/config.js`). While `CASH_OPS_ENABLED != 'true'`
  in the environment, **all** of them return `403 { "error": "Cash operations
  are disabled." }` — including the mock webhook.
- **MOCK provider only.** Deposits are simulated through
  `src/fintech/mockProvider.js`. No real HTTP calls, no real credentials, no
  live secrets anywhere in this code or in these docs.
- **Integer kobo everywhere.** Balances are computed from the double-entry
  ledger (`ledger.getCashBalance`); no client-supplied balance is ever trusted.
- **Double-entry for every value movement** via `ledger.postJournal`
  (atomic, idempotent on `journal_key`). Posted journals are **never** edited
  or deleted — corrections post a new mirrored journal via
  `ledger.reverseJournal`.
- **Separation:** cash kobo (`cash_wallets`) and gameplay coins
  (`characters.money`) are fully independent ledgers. No code path converts
  between them.
- There is deliberately **no `user_id` parameter** on any endpoint. Every
  route operates on `req.userId` from the bearer token, so one user can never
  read or move another user's cash.

## Auth

All endpoints require `Authorization: Bearer <token>` (same token scheme as the
rest of the API). Missing/invalid token → `401 { "error": "Auth required." }` /
`{ "error": "Invalid or expired token." }`.

## Endpoints

### GET /balance

Current cash position, computed from the ledger.

Response `200`:
```json
{ "available_kobo": 75000, "reserved_kobo": 0, "currency": "NGN" }
```

### GET /history?limit=&offset=

The caller's own `ledger_journals`, newest-first, each with its entries
(account codes resolved via `ledger_accounts`).

- `limit`: default `50`, clamped to `1..200`. Invalid values fall back to the default.
- `offset`: default `0`; negative/invalid values fall back to `0`.

Response `200`:
```json
{
  "journals": [
    {
      "id": 12,
      "journal_key": "deposit:confirm:MOCK-DEP-A1B2C3D4:7",
      "type": "deposit",
      "status": "posted",
      "provider_ref": "MOCK-DEP-A1B2C3D4:7",
      "memo": "MOCK deposit confirmed: MOCK-DEP-A1B2C3D4:7",
      "created_at": 1760100000000,
      "entries": [
        { "side": "debit",  "amount_kobo": 75000, "account_code": "deposit_processing" },
        { "side": "credit", "amount_kobo": 75000, "account_code": "customer_available" }
      ]
    }
  ],
  "limit": 50,
  "offset": 0
}
```

### POST /deposit/initiate

Creates a **pending** deposit and a MOCK provider reference. Nothing is
credited here — the wallet moves only when a signed mock webhook confirms.

Request:
```json
{ "amount_kobo": 75000, "currency": "NGN" }
```
- `amount_kobo` (required): integer kobo, **min 10000 (₦100), max 100000000 (₦1,000,000)**.
- `currency`: optional; if present it must be `"NGN"`.

Response `200`:
```json
{
  "deposit_id": 7,
  "provider_ref": "MOCK-DEP-A1B2C3D4:7",
  "amount_kobo": 75000,
  "currency": "NGN",
  "status": "pending",
  "mock_checkout": {
    "reference": "MOCK-DEP-A1B2C3D4:7",
    "instructions": "MOCK — no real money moves. To simulate provider confirmation in tests, POST a signed mock webhook to /api/cash-wallet/deposit/mock-webhook with this provider_ref (see docs/CASH_API.md for the signature scheme)."
  }
}
```

Error cases (`400`):
- `amount_kobo` missing / not an integer / ≤ 0 (`"amount_kobo must be an integer number of kobo."`)
- outside `[10000, 100000000]` (`"amount_kobo must be between 10000 and 100000000 kobo."`)
- `currency` present and not `"NGN"` (`"Only 'NGN' deposits are supported."`)

Notes:
- The `cash_deposits` row is inserted first with `journal_key = "deposit:init:<id>"`
  (id-keyed after insert), status `pending`, provider `mock`.
- The mock provider reference is deterministic per `(userId, amountKobo)`, so the
  deposit id is suffixed (`MOCK-DEP-<HASH>:<deposit_id>`) to keep `provider_ref`
  unique per deposit row.
- A `fintech_audit_logs` row (`deposit.initiate`) is written.

### POST /deposit/mock-webhook

*** TEST-ONLY endpoint. *** Simulates the payment provider calling back after a
deposit settles. Still gated by `authMiddleware` + `requireCashOps` like every
other route.

Request:
```json
{
  "provider_ref": "MOCK-DEP-A1B2C3D4:7",
  "status": "confirmed",
  "amount_kobo": 75000,
  "currency": "NGN",
  "signature": "<hmac-sha256 hex>"
}
```

#### Mock signature scheme (TEST-ONLY)

`signature` = HMAC-SHA256 hex of the exact string

```
${provider_ref}|${status}|${amount_kobo}|${currency}
```

keyed by `process.env.MOCK_WEBHOOK_SECRET`.

**Fallback warning:** when `MOCK_WEBHOOK_SECRET` is unset, the router falls back
to the constant `MOCK_WEBHOOK_SECRET_FALLBACK = 'mock-test-secret-NOT-FOR-PRODUCTION'`,
exported from `src/routes/cashWallet.js`. This fallback exists **only so local
flow tests can run without setup** — it is NOT a security boundary. Never rely
on it for anything real; a live provider integration must use its own signing
key, rotated secrets, and timestamp/replay protection. A `signMockWebhook()`
helper is exported from the router module so tests can build valid bodies.

The comparison uses `crypto.timingSafeEqual`. A bad signature → `400
{ "error": "Invalid webhook signature." }` and a `provider_events` row with
`signature_valid = 0`.

#### Processing rules

1. Look up `cash_deposits` by `provider_ref`. Unknown → `404`.
2. `amount_kobo` and `currency` must **exactly match** the initiated deposit —
   mismatch → `400`, **no credit**, event recorded with `processed = 0`.
3. `status: "confirmed"`:
   - Already `confirmed` → return the existing receipt with `"duplicate": true`
     — **no second journal is posted** (duplicate-delivery safe).
   - `pending` → posts one journal (`journal_key =
     "deposit:confirm:<provider_ref>"`, type `deposit`:
     **debit `deposit_processing` / credit `customer_available`**) inside a
     `dbTransaction` together with the deposit's `confirmed` status update.
     The journal key's uniqueness makes even racing replays post exactly once.
     Returns the receipt below (`200`).
   - Any other deposit state → `400` (a `failed`/`expired`/`refunded` deposit
     can never be confirmed).
4. `status: "failed"` / `"expired"` → deposit marked accordingly, **no credit**
   (`200`). Rejected with `400` if the deposit is already `confirmed` (a
   confirmed deposit can only be undone via `refunded`).
5. `status: "refunded"`:
   - Was `confirmed` → the confirm journal is reversed via a **new**
     `reversal` journal (`reverseJournal`, reason `"provider refund"`; the
     original posted rows are never edited), balance drops back, deposit
     marked `refunded`.
   - Was `pending` → just marked `refunded` (nothing was ever credited).
   - Already `refunded` → no-op replay, acknowledged (`200`), nothing new posted.
6. `status: "pending"` → no-op acknowledgement (`200`, current receipt).
7. Any other `status` → `400 { "error": "Unknown webhook status '…'." }`.

**Every** webhook — valid or not — writes a `provider_events` row
(`provider='mock'`, `event_type='deposit.webhook'`, `signature_valid`,
`processed` flags) and a `fintech_audit_logs` row (`deposit.webhook.*`).

Receipt response (`200`, also returned by duplicate/replay paths):
```json
{
  "deposit_id": 7,
  "provider_ref": "MOCK-DEP-A1B2C3D4:7",
  "amount_kobo": 75000,
  "currency": "NGN",
  "status": "confirmed",
  "confirmed_at": 1760100050000,
  "journal_key": "deposit:init:7",
  "available_kobo": 75000,
  "reserved_kobo": 0,
  "duplicate": true
}
```
(`duplicate` is present only on duplicate-delivery replays.)

## Limits summary

| Rule | Value |
|---|---|
| Deposit min | 10,000 kobo (₦100) |
| Deposit max | 100,000,000 kobo (₦1,000,000) |
| Currency | `NGN` only |
| History page size | 1–200 (default 50) |
| `CASH_OPS_ENABLED` unset | every endpoint → `403` |

## Boot wiring

`src/app.js` calls `ensureChartOfAccounts()` + `ensureFeePolicyV1()` (from
`src/fintech/seed.js`) immediately after `initDb()` during `createApp()`.
Both are idempotent (`INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`), so they
are safe to run on every boot.

## Tables touched (additive only)

`ledger_journals`, `ledger_entries`, `cash_wallets`, `cash_deposits`,
`provider_events`, `fintech_audit_logs` — plus the seeded `ledger_accounts`
and `fee_policies`. Game tables are never touched.


# CASH_API — Part B: P2P Transfers & Withdrawals (Milestones 6b + 7)

Base mount: `/api/cash-wallet` (coordinator mounts `createCashFlowsRouter()` from
`server/src/routes/cashFlows.js`).

**Auth:** all routes require `Authorization: Bearer <token>` (authMiddleware) and
pass through `requireCashOps` → every route returns **403**
`{"error":"Cash operations are disabled."}` while `CASH_OPS_ENABLED != 'true'`.

**Money:** integer NGN kobo everywhere. No commission on P2P. Withdrawals carry a
10% commission (fee policy v1, 1000 bps, round half up), recognized **only on
completion**. Full account numbers are never returned or logged — responses carry
`account_number_masked` (`"******1234"`).

**Account status:** `cash_wallets.account_status` (`'active'` default). When it is
anything other than `'active'`, SENDING (transfer/withdraw) is blocked with 403.

**State machine** (`cash_withdrawal_requests.status`):
`requested → reserved → submitted → processing → completed`, with
`requested|reserved|submitted|processing → failed` and
`completed|failed|rejected|reversed` terminal.

---

## POST /transfer

Move cash between two players' wallets. No commission. Posts two balanced
journals atomically (`:sender` leg and `:recipient` leg) inside one DB transaction.

Auth: Bearer token (sender) · CashOps on

Request:
```json
{
  "recipient_username": "adaeze",
  "amount_kobo": 25000,
  "idempotency_key": "client-uuid-1"
}
```

Response 200:
```json
{
  "transfer_id": 12,
  "amount_kobo": 25000,
  "currency": "NGN",
  "sender": "drblack",
  "recipient": "adaeze",
  "status": "completed",
  "completed_at": 1760090000000,
  "journal_keys": {
    "transfer": "transfer:client-uuid-1",
    "sender": "transfer:client-uuid-1:sender",
    "recipient": "transfer:client-uuid-1:recipient"
  }
}
```

Errors:
| Status | When |
|---|---|
| 400 | missing/invalid body; `amount_kobo` not an integer in [1000, 20000000] kobo; self-transfer |
| 401 | missing/invalid bearer token |
| 403 | cash ops off; sender account not `active`; recipient account not `active` |
| 404 | recipient username not found |
| 429 | rolling-24h completed-transfer total + this amount would exceed 50,000,000 kobo (₦500,000/day) |
| — | replaying an existing `idempotency_key` returns the ORIGINAL receipt (200) and posts nothing |

Example:
```bash
curl -X POST http://localhost:3000/api/cash-wallet/transfer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"recipient_username":"adaeze","amount_kobo":25000,"idempotency_key":"t-001"}'
```

---

## POST /beneficiaries

Save a bank payout destination. Validates `bank_code` (3–6 digits) and
`account_number` (exactly 10 digits, NUBAN). When `account_name` is omitted, a
deterministic MOCK name enquiry fills it (no real lookup). Duplicate
(user, bank_code, account_number) → 409.

Auth: Bearer token · CashOps on

Request:
```json
{ "label": "My GTB", "bank_code": "058", "account_number": "0123456789" }
```

Response 201:
```json
{
  "id": 3,
  "label": "My GTB",
  "bank_code": "058",
  "account_number_masked": "******6789",
  "account_name": "Adaeze Okafor",
  "verified": true
}
```

Errors:
| Status | When |
|---|---|
| 400 | bad label / bank_code / account_number / account_name |
| 401 | missing/invalid bearer token |
| 403 | cash ops off |
| 409 | beneficiary already saved |

---

## GET /beneficiaries

List the caller's saved beneficiaries (masked account numbers only).

Auth: Bearer token · CashOps on

Response 200:
```json
{ "beneficiaries": [ { "id": 3, "label": "My GTB", "bank_code": "058",
  "account_number_masked": "******6789", "account_name": "Adaeze Okafor",
  "verified": true } ] }
```

Errors: 401 (auth), 403 (cash ops off).

---

## POST /withdrawals/quote — step 1 of 2

Get an exact, fee-policy-bound commission breakdown before committing funds.
Returns a single-use `quote_token` (32 hex chars) that pins
{user, beneficiary, gross_kobo} and expires in 10 minutes.
**Single-process limitation:** quote tokens live in an in-memory Map; a restart
or a second Node process loses them (acceptable for this milestone; move to a
DB table before any durable provider integration).

Auth: Bearer token · CashOps on

Request:
```json
{ "beneficiary_id": 3, "gross_kobo": 100000 }
```

Response 200:
```json
{
  "gross_kobo": 100000,
  "commission_kobo": 10000,
  "net_kobo": 90000,
  "rate_bps": 1000,
  "fee_policy_version": 1,
  "quote_token": "9f2c…(32 hex)…",
  "expires_at": 1760090600000
}
```

Errors:
| Status | When |
|---|---|
| 400 | bad beneficiary_id / gross_kobo (< 50000 kobo = ₦500); beneficiary unverified |
| 401 | missing/invalid bearer token |
| 403 | cash ops off |
| 404 | beneficiary not found (or not the caller's) |

---

## POST /withdrawals — step 2 of 2

Execute a quoted withdrawal. Validates the quote token, eligibility, and
idempotency (`journal_key = "withdrawal:<idempotency_key>"` — replay returns the
original record). Inside one DB transaction: insert `requested` → reserve journal
(`customer_available → customer_reserved`, gross) → `reserved` → MOCK provider
payout submission (net amount) → `submitted` with `provider_ref`.

Auth: Bearer token · CashOps on

Request:
```json
{
  "beneficiary_id": 3,
  "gross_kobo": 100000,
  "idempotency_key": "wd-001",
  "quote_token": "9f2c…"
}
```

Response 201:
```json
{
  "withdrawal_id": 7,
  "status": "submitted",
  "breakdown": {
    "gross_kobo": 100000,
    "commission_kobo": 10000,
    "net_kobo": 90000,
    "rate_bps": 1000,
    "fee_policy_version": 1
  },
  "provider_ref": "MOCK-PAY-3F2A9C1D"
}
```

Errors:
| Status | When |
|---|---|
| 400 | bad body; invalid/expired/consumed/tampered quote_token; insufficient available balance |
| 401 | missing/invalid bearer token |
| 403 | cash ops off; sender account not `active` |
| 404 | beneficiary not found |
| — | same `idempotency_key` → original record (200), no second reserve journal |

---

## GET /withdrawals/:id

Withdrawal status for the owner only (404 for anyone else — no existence leak).

Auth: Bearer token · CashOps on

Response 200:
```json
{
  "id": 7,
  "status": "completed",
  "breakdown": { "gross_kobo": 100000, "commission_kobo": 10000,
    "net_kobo": 90000, "rate_bps": 1000, "fee_policy_version": 1 },
  "beneficiary": { "id": 3, "label": "My GTB", "bank_code": "058",
    "account_number_masked": "******6789", "account_name": "Adaeze Okafor",
    "verified": true },
  "provider_ref": "MOCK-PAY-3F2A9C1D",
  "failure_reason": null,
  "created_at": 1760090000000,
  "updated_at": 1760090060000,
  "completed_at": 1760090060000
}
```

---

## POST /withdrawals/:id/mock-advance

Simulate provider settlement polling. **Consults
`mockProvider.getPayoutStatus(provider_ref)` FIRST and only acts on its result —
never a blind retry.** On `settled` while status is `submitted`/`processing`, one
transaction posts the completion journal
(`customer_reserved → withdrawal_clearing`, gross) and the commission journal
(`withdrawal_clearing → platform_commission` commission_kobo +
`withdrawal_clearing → provider_clearing` net_kobo; both journals balanced),
then flips status to `completed`. Advances after `completed` return the current
state and post nothing (journal_key idempotency).

Auth: Bearer token (owner) · CashOps on

Response 200: same shape as GET /withdrawals/:id, status `completed`.

Errors: 401, 403, 404 (not found / not owner), 409 (not yet submitted).

---

## POST /withdrawals/:id/mock-fail

Simulate a provider failure. Only valid pre-completion
(`requested|reserved|submitted|processing`). Posts a release journal
(`customer_reserved → customer_available`, gross) and flips status to `failed`
with `failure_reason`. **No commission reversal is needed** — commission is only
recognized on completion, so nothing was ever booked.

Auth: Bearer token (owner) · CashOps on

Request: `{ "reason": "provider timeout (simulated)" }`

Response 200: same shape as GET /withdrawals/:id, status `failed`.

Errors: 400 (reason missing), 401, 403, 404 (not found / not owner), 409 (already terminal).

---

## Design notes for the merge

- `notifyCashEvent(userId, event, payload)` (exported from
  `src/routes/cashFlows.js`) is a **stub for future push/WS**: today it writes a
  `fintech_audit_logs` row only. Wire real delivery here later.
- Commission-recognition decision: commission journal posts only at
  mock-advance completion. Failure path = release journal only.
- Two-step withdrawal rationale: exact pre-commit quote, fee-policy version
  binding, tamper-proof amounts via `quote_token`; the server re-derives all
  money math from the bound quote.
- Error taxonomy: `code` fields are `VALIDATION`, `RECIPIENT_NOT_FOUND`,
  `SELF_TRANSFER`, `ACCOUNT_NOT_ACTIVE`, `RECIPIENT_NOT_ACTIVE`,
  `VELOCITY_EXCEEDED`, `DUPLICATE_BENEFICIARY`, `BENEFICIARY_NOT_FOUND`,
  `BENEFICIARY_UNVERIFIED`, `BAD_QUOTE`, `INSUFFICIENT_FUNDS`, `BAD_STATE`,
  `NOT_FOUND`, plus ledger `INSUFFICIENT_FUNDS`.

---

# CASH_API — Part C: Provider webhooks (Milestone 8)

## Adapter architecture

`server/src/fintech/provider.js` defines ONE adapter interface every cash
provider implements:

```js
adapter.name                                            // 'mock' | 'paystack' | 'flutterwave'
await adapter.initiateDeposit({ amountKobo, reference?, currency?, userId? })
await adapter.verifyDeposit(reference)
await adapter.initiatePayout({ beneficiary?, netKobo, reference?, userId? })
await adapter.getPayoutStatus(providerRef)
adapter.verifyWebhookSignature(rawBody, headers, secret) // -> boolean (pure crypto, no I/O)
adapter.parseWebhookEvent(rawBody)                       // -> { providerRef, status, amountKobo, currency, raw }
```

- `MockAdapter` wraps the existing deterministic MOCK functions in
  `server/src/fintech/mockProvider.js` (unchanged behavior, clearly labeled).
- `PaystackAdapter` / `FlutterwaveAdapter` are **skeletons**: their API-call
  bodies (`initiateDeposit`, `verifyDeposit`, `initiatePayout`,
  `getPayoutStatus`) are explicit TODO stubs that throw
  `ProviderNotConfiguredError` — they make **no network calls**. Only the
  webhook signature verification is real (see below).

`getProvider()` reads `process.env.PROVIDER` (`'mock'` | `'paystack'` |
`'flutterwave'`, default `'mock'`). `POST /deposit/initiate` uses it to mint
deposit references. Behavior under `PROVIDER=mock` is unchanged.

## Endpoint: POST /deposit/webhook/:provider

**No user auth.** Provider webhooks are signature-authenticated, not
user-authenticated — there is no `Authorization` header requirement. Still
gated by `requireCashOps` (403 while `CASH_OPS_ENABLED != 'true'`, like every
other cash route).

**Raw body:** `src/app.js` configures `express.json()` with a `verify()`
callback that captures the raw request bytes on `req.rawBody`. Signature
verification runs on those **exact bytes** — never on a re-serialized
`req.body` (re-serialization changes bytes and breaks HMAC checks). The
payload is treated as **untrusted** until the adapter's
`verifyWebhookSignature()` accepts it.

### Signature schemes (implemented per the providers' documented schemes)

| Provider | Header | Scheme | Secret from |
|---|---|---|---|
| `mock` | `signature` field in the JSON body | HMAC-SHA256 hex of `${provider_ref}\|${status}\|${amount_kobo}\|${currency}` (test-only, NOT a real security boundary) | `MOCK_WEBHOOK_SECRET` (fallback constant in `cashWallet.js`, tests only) |
| `paystack` | `x-paystack-signature` | HMAC-SHA512 hex of the **raw request body** (checked against current Paystack docs on 2026-10-10) | `PAYSTACK_SECRET_KEY` |
| `flutterwave` | `verif-hash` | timing-safe comparison against the **secret hash configured on the Flutterwave dashboard** (checked against current Flutterwave docs on 2026-10-10) | `FLUTTERWAVE_WEBHOOK_HASH` (or `FLUTTERWAVE_WEBHOOK_SECRET`) |

### Verification-status storage

**Every** webhook — valid or not — writes a `provider_events` row
(`provider`, `event_type='deposit.webhook'`, `provider_ref`,
`signature_valid`, `processed`) and a `fintech_audit_logs` row. For the new
route the raw event bytes are stored **verbatim** in the `payload` column
(capped at 8k chars) so rejected events remain forensically inspectable.

### Exact-once semantics

Both `/deposit/mock-webhook` (legacy test endpoint) and
`/deposit/webhook/:provider` drive the **same** shared crediting path
(`processDepositWebhookEvent` in `cashWallet.js`):

1. Amount and currency must **exactly match** the initiated deposit — mismatch
   → 400, **no credit**.
2. `status: "confirmed"` on an already-`confirmed` deposit → same receipt with
   `"duplicate": true`, **no second journal posted** (the
   `deposit:confirm:<provider_ref>` journal key can only ever post once, so
   even racing replays are safe).
3. `failed`/`expired`/`refunded`/`pending` handling is identical to the
   documented mock-webhook rules (see Part A). Refunds of confirmed deposits
   reverse via a **new** `reversal` journal — posted rows are never edited.

A rejected signature (or unparsable payload) → 400, nothing credited, event
stored with `signature_valid = 0`.

## Switching PROVIDER

```bash
PROVIDER=mock          # default: deterministic mock, local testing
PROVIDER=paystack       # requires PAYSTACK_SECRET_KEY (+ PAYSTACK_PUBLIC_KEY)
PROVIDER=flutterwave    # requires FLUTTERWAVE_SECRET_KEY / FLWSECK_TEST (+ FLUTTERWAVE_WEBHOOK_HASH)
```

## Fail-closed rules

- A non-mock `PROVIDER` requires **both** `CASH_OPS_ENABLED=true` **and** the
  provider's credentials in env — otherwise `getProvider()` throws
  `ProviderNotConfiguredError` (never silently falls back to mock).
- Unknown `PROVIDER` values throw.
- `/deposit/webhook/:provider` resolves its adapter by the `:provider` path
  parameter with the same fail-closed rules: unknown or unconfigured provider
  names get `404 { "error": "Unknown or unconfigured provider '…'." }` — the
  route never processes a webhook it cannot verify.
- Even fully configured, the skeletons' API-call bodies throw TODO errors:
  **live money requires written provider approval per
  `docs/PROVIDER_APPROVAL_CHECKLIST.md` + a real implementation** (Milestone
  11). Live money stays OFF.

---

# CASH_API — Part C: Cash Admin — Risk Controls, Review & Reconciliation (Milestone 9)

Base path: `/api/admin/cash` (mounted in `src/routes/api.js`).
All routes require **both** `CASH_OPS_ENABLED=true` (`requireCashOps` → 403 while
off) **and** admin auth: `Authorization: Bearer <token>` for a user row with
`is_admin=1` and not banned (same rule as `requireAdmin` in `src/routes/admin.js`;
non-admin → 403). All amounts are integer kobo. Live money stays OFF — the
provider is MOCK-only.

## Withdrawal state machine (valid transitions)

```
requested -> reserved        reserve journal posted (customer_available -> customer_reserved)
reserved  -> under_review    risk policy diverted; review opened in risk_reviews.
                             The DB row keeps status 'reserved'; the API reports the
                             EFFECTIVE status 'under_review' while the review is open.
under_review -> submitted    admin APPROVE: payout submitted to provider
under_review -> rejected      admin REJECT: reserved funds released via a compensating
                             journal (customer_reserved -> customer_available); terminal
under_review -> failed        user cancels via POST /withdrawals/:id/mock-fail; terminal
submitted -> processing -> completed
                             provider settles; 10% commission recognized ONLY on completion
submitted|processing -> failed
                             provider failure; reserved funds released; terminal
completed|failed|rejected     terminal — no further transitions
```

Under-review policy (`src/fintech/risk.js`): a withdrawal diverts to review when
`gross_kobo >= ₦500,000` (50,000,000 kobo, `LARGE_WITHDRAWAL`) — always — or when
its beneficiary was created < 24h ago (`NEW_BENEFICIARY`), the latter only when
`CASH_RISK_NEW_BENEFICIARY_REVIEW=true` (default off; the signal is audit-logged
either way). Per-transaction deposit cap: ₦1,000,000 — enforced by the existing
`DEPOSIT_MAX_KOBO` bounds check in `POST /deposit/initiate`
(`src/routes/cashWallet.js`), which rejects over-limit amounts with 400.
Withdrawal daily cap: ₦2,000,000/day of completed withdrawals (`429
WITHDRAWAL_DAILY_CAP_EXCEEDED`).

## Endpoints

### GET /api/admin/cash/overview
Totals: `customer_liabilities_kobo` (`total`/`available`/`reserved` from
`cash_wallets`), `commission_earned_kobo` (net credit on `platform_commission`),
`counts` (`wallets`, `pending_deposits`, `pending_withdrawals`,
`under_review_withdrawals`), `generated_at`.

### GET /api/admin/cash/journals?user_id=&type=&from=&to=&limit=
Ledger journals newest-first with embedded entries.
`type` ∈ `deposit|transfer|withdrawal|commission|reversal|adjustment`;
`from`/`to` are ms epochs on `created_at`; `limit` default 50, max 200.

### GET /api/admin/cash/withdrawals?status=&limit=
`status`: `open` (default — every non-terminal withdrawal), `pending`
(non-terminal with no open review), `under_review`, `submitted`, `failed`,
`rejected`, `completed`, `all`. Rows carry the effective status plus a `review`
object (`id`, `status`, `reasons`, `note`, `created_at`) when a review is open;
beneficiary account numbers are masked (`******1234`).

### GET /api/admin/cash/deposits?status=&limit=
`status`: `all` (default), `pending`, `confirmed`, `failed`, `refunded`, `expired`.

### GET /api/admin/cash/audit?action=&actor=&entity=&limit=
`fintech_audit_logs` newest-first, filterable. Every admin action below writes
here with `actor: "admin:<id>"`.

### POST /api/admin/cash/users/:id/restrict
Body: `{ "status": "suspended" | "active", "reason": "..." }` — `reason` is
mandatory (400 without). Sets `cash_wallets.account_status` (creates the wallet
row at zero balances if missing — balances are never set here) and writes a
`cash.account.restrict` audit row with admin id + previous status + reason; the
user is notified (`cash.account.restricted`). Suspended users are already
blocked from transfers and withdrawals by the existing `account_status` gates
in `src/routes/cashFlows.js`.

### POST /api/admin/cash/adjustments
Body: `{ "user_id", "debit_account", "credit_account", "amount_kobo", "reason" }`.
Posts a **balanced** double-entry journal (`type: 'adjustment'`) through the
ledger engine — unbalanced journals are rejected by the engine, unknown account
codes 400, `reason` mandatory (400 without), debit ≠ credit required. The admin
id + reason land in `fintech_audit_logs` (`cash.adjustment.post`) and in the
journal metadata. **There is deliberately no way to set a balance directly:**
the only write shape is debit-account/credit-account/amount; a request without
accounts (e.g. `{ "target_balance_kobo": … }`) is rejected with 400.

### POST /api/admin/cash/withdrawals/:id/approve
Body: `{ "reason": "..." }` (mandatory). Requires an open review and row status
`reserved` (else 409). Atomically marks the review `approved` (reviewer id +
reason recorded) and resumes the payout flow → row becomes `submitted` with a
provider ref. User is notified (`cash.withdrawal.review.approved`); the decision
is audited (`cash.withdrawal.review.approved`).

### POST /api/admin/cash/withdrawals/:id/reject
Body: `{ "reason": "..." }` (mandatory). Requires an open review and row status
`reserved` (else 409). Atomically: posts a compensating journal releasing the
reserved gross back to available (the reserve journal is never edited; no
commission reversal is needed because commission is only recognized on
completion), marks the row `rejected` with `failure_reason = reason`, closes the
review as `rejected`. User is notified (`cash.withdrawal.review.rejected`); the
decision is audited (`cash.withdrawal.review.rejected`).

### GET /api/admin/cash/reconcile
Reconciliation report (see `docs/RECONCILIATION.md` for the operational
procedure):
```json
{
  "generated_at": 0,
  "totals": {
    "customer_available_kobo": 0,
    "customer_reserved_kobo": 0,
    "customer_liabilities_kobo": 0,
    "commission_earned_kobo": 0,
    "clearing_accounts": {
      "deposit_processing":   { "net_credit_kobo": 0 },
      "provider_clearing":    { "net_credit_kobo": 0 },
      "withdrawal_clearing":  { "net_credit_kobo": 0 },
      "platform_commission":  { "net_credit_kobo": 0 },
      "provider_fees":        { "net_credit_kobo": 0 },
      "refunds_chargebacks":  { "net_credit_kobo": 0 }
    }
  },
  "balanced": true,
  "open_items": {
    "pending_deposits":  [{ "id": 0, "user_id": 0, "amount_kobo": 0, "provider_ref": null, "created_at": 0 }],
    "submitted_payouts": [{ "id": 0, "user_id": 0, "gross_kobo": 0,  "provider_ref": null, "created_at": 0 }],
    "under_review":      [{ "review_id": 0, "withdrawal_id": 0, "user_id": 0, "gross_kobo": 0, "reasons": [], "created_at": 0 }],
    "stuck_reserved":    [{ "id": 0, "user_id": 0, "gross_kobo": 0, "updated_at": 0 }]
  },
  "differences": []
}
```
Checks: (1) every posted/reversed journal balances (`UNBALANCED_JOURNAL`,
error); (2) per-user wallet cache vs ledger (`WALLET_MISMATCH`, error);
(3) liability identity — customer liabilities vs net debit position of all other
accounts (`LIABILITY_MISMATCH`, error); (4) every confirmed deposit has a
processed, signature-valid provider event (`MISSING_PROVIDER_EVENT`, error);
(5) `reserved` > 30 min with no open review (`STUCK_RESERVATION`, warning).
`balanced` is true only when `differences` is empty. Expected/timing open items
(same-day pendings) do not affect `balanced`; see `docs/RECONCILIATION.md` for
the daily/weekly procedure and the incident checklist.

## Error codes (admin)
`Admin only.` (403) · `Cash operations are disabled.` (403) ·
`NO_OPEN_REVIEW` (409) · `BAD_STATE` (409) · `VALIDATION` (400) ·
`DEPOSIT_CAP_EXCEEDED` (400) · `WITHDRAWAL_DAILY_CAP_EXCEEDED` (429) ·
`NOT_FOUND` (404).

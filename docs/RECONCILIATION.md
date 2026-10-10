# Cash Reconciliation — Operational Procedure (Milestone 9)

Live endpoint: `GET /api/admin/cash/reconcile` (admin auth + `CASH_OPS_ENABLED=true`).
All amounts are integer kobo. The ledger is the source of truth; `cash_wallets`
is a cache maintained by the ledger engine on every journal post.

## 1. Daily reconciliation (every morning)

1. `GET /api/admin/cash/reconcile` and save the JSON (keep 90 days).
2. Check `balanced`:
   - `true` → file the report, done.
   - `false` → work through every entry in `differences[]` (below).
3. Review `open_items`:
   - `pending_deposits[]` — deposits initiated but not yet confirmed by the
     provider. Same-day pendings are normal (user started checkout, hasn't
     paid). Anything pending **> 24h** → contact the user / expire it via the
     provider webhook path (`expired`); never delete the row.
   - `submitted_payouts[]` — withdrawals submitted to the provider but not
     yet settled. Same-day items are normal timing. Items **> 48h** →
     query the provider for the payout status; on confirmed failure, fail the
     withdrawal so reserved funds release back to the user.
   - `under_review[]` — withdrawals held by the risk policy awaiting an
     admin decision. **Action every item, same day**: approve (resumes payout)
     or reject (releases funds). A review must never sit open overnight.
   - `stuck_reserved[]` — withdrawals stuck in `reserved` with no open review
     for > 30 min. This should not happen (payout submission after reserve is
     near-instant). Treat as an incident (section 4).

## 2. Weekly reconciliation (deeper)

1. Run the daily steps, then:
2. `GET /api/admin/cash/journals?type=adjustment&from=<week-ago-ms>` — every
   manual adjustment must have a business reason in its memo/metadata and a
   matching `cash.adjustment.post` row in `GET /api/admin/cash/audit`.
   Adjustments without a reason are a finding (the API requires `reason`, so
   this indicates a code-level bypass — investigate).
3. `GET /api/admin/cash/overview` — plot `customer_liabilities_kobo.total`
   and `commission_earned_kobo` week-over-week. An unexpected drop in
   liabilities with no matching withdrawals is a finding.
4. Spot-check 5–10 random journals from `/journals`: debits == credits,
   sensible memos, no round-number-only patterns that suggest fabrication.

## 3. Reading the report

```json
{
  "generated_at": 1728566400000,
  "totals": {
    "customer_available_kobo": 125000000,
    "customer_reserved_kobo": 4000000,
    "customer_liabilities_kobo": 129000000,
    "commission_earned_kobo": 3200000,
    "clearing_accounts": {
      "deposit_processing":   { "net_credit_kobo": -100000000 },
      "provider_clearing":    { "net_credit_kobo": 30000000 },
      "withdrawal_clearing":  { "net_credit_kobo": 0 },
      "platform_commission":  { "net_credit_kobo": 3200000 },
      "provider_fees":        { "net_credit_kobo": 0 },
      "refunds_chargebacks":  { "net_credit_kobo": 0 }
    }
  },
  "balanced": true,
  "open_items": { "pending_deposits": [], "submitted_payouts": [],
                  "under_review": [], "stuck_reserved": [] },
  "differences": []
}
```

### Which differences are EXPECTED (timing, not breakage)

- **Open items with same-day timestamps.** A `submitted` payout that hasn't
  settled yet, a `pending` deposit from an hour ago, an `under_review`
  withdrawal from this morning — these are in-flight business states, listed
  so nothing gets forgotten. They do NOT set `balanced: false`.
- **Clearing accounts carrying balances.** `deposit_processing` holds a net
  debit while deposits await confirmation; `provider_clearing` carries the
  net of in-flight transfers/payouts. Non-zero is normal; what matters is the
  identity in the next section.

### Which differences are ALARMING (set `balanced: false`, act now)

| code | severity | meaning | first action |
|---|---|---|---|
| `UNBALANCED_JOURNAL` | error | A posted journal's debits ≠ credits. The ledger engine prevents this at write time, so its presence means direct DB writes or corruption. | Freeze cash ops (`CASH_OPS_ENABLED` off), find the journal, reverse it, investigate the write path. |
| `WALLET_MISMATCH` | error | `cash_wallets` cache ≠ ledger-computed balance for a user. | Do NOT "fix" the wallet row. Find the journal(s) that moved value without the wallet update (or vice versa); correct with an `adjustment` journal + audit entry. |
| `LIABILITY_MISMATCH` | error | Σ customer liabilities ≠ net debit position of all other accounts. With balanced journals this is a tautology — its presence means check 1 missed something or an account code is outside the known chart. | Same as `UNBALANCED_JOURNAL`. |
| `MISSING_PROVIDER_EVENT` | error | A `confirmed` deposit has no processed, signature-valid provider event. Money was credited without provider evidence. | Verify with the provider whether the deposit really settled; if not, reverse the confirmation journal. |
| `STUCK_RESERVATION` | warning | `reserved` > 30 min with no open review. | Check server logs around the reserve timestamp; manually submit or fail the withdrawal so funds don't sit locked. |

## 4. Incident checklist

1. **Stop the bleeding.** If money integrity is in doubt, set
   `CASH_OPS_ENABLED=false` (all cash routes 403 instantly; gameplay is
   unaffected).
2. **Snapshot.** `GET /api/admin/cash/reconcile` → save JSON.
   `GET /api/admin/cash/audit?limit=200` → save JSON.
3. **Scope.** Which users/journals are affected? (`/journals?user_id=`,
   `/withdrawals?status=`, `/deposits?status=`.)
4. **Correct via journals only.** Reversals and `adjustment` journals —
   never UPDATE/DELETE posted rows, never hand-edit `cash_wallets`.
   Every correction carries a `reason` and lands in `fintech_audit_logs`
   with the admin's id.
5. **Notify.** Affected users get a `notifyCashEvent` entry; user-facing
   comms go through the normal support channel with the incident id.
6. **Post-mortem.** Root cause → code fix → regression test in
   `server/tests/fintech_admin.test.js`. File under `docs/`.

## 5. Notes for auditors

- Posted journals are immutable; corrections are new `reversal` /
  `adjustment` journals linked by `related_journal_id`.
- Every admin action writes `fintech_audit_logs` with `actor:
  "admin:<id>"` — including restrictions, adjustments, and review
  decisions.
- Full account numbers never appear in API responses (masked `******1234`);
  they live only in `cash_withdrawal_beneficiaries.account_number`, which
  the payout provider needs. Never log that column.
- Commission is recognized ONLY on withdrawal completion, never on
  reserve — a rejected/failed withdrawal needs no commission reversal
  because no commission journal was ever posted.

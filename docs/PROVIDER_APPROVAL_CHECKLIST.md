# Provider Approval Checklist — written confirmation required before live money

Applies to each provider evaluated (start with **Paystack**, then
**Flutterwave**). Do not assume a "yes" in one row implies a "yes" in any
other. Get every answer **in writing** (email or signed document from an
authorized representative — not a sales chat, not a landing page).

## Business & product

- [ ] Our business category (gaming / life-simulation with cash wallet) is an
      accepted category on your platform.
- [ ] Our company (CAC-registered entity, directors verified) passes your KYB.

## Collection (deposits)

- [ ] We may collect user deposits (NGN) for this product via your checkout /
      transfer / direct-debit rails.
- [ ] Confirmed: settlement timeline to our account, settlement account
      requirements, and any rolling reserve or holdback.

## Holding balances

- [ ] We may **hold customer NGN balances** on your platform between deposit
      and withdrawal/transfer (i.e. operate a stored-value / wallet model).
- [ ] If not: the exact alternative you require (e.g. immediate pass-through,
      licensed partner) — in writing.

## Peer-to-peer transfers

- [ ] Users may transfer their cash balances **to other users** on our
      platform (not just to themselves / merchants).
- [ ] Confirmed: any per-transaction and daily limits you impose on P2P.

## Withdrawals / payouts

- [ ] We may pay out to **users' Nigerian bank accounts** (NIP / bank transfer
      rails), including accounts not previously used for deposit.
- [ ] Confirmed: beneficiary name-verification tooling, payout timelines,
      per-transaction and daily payout limits, and payout fees.

## Identity & verification

- [ ] Required KYC tiers for (a) deposits, (b) P2P transfers, (c) withdrawals —
      document type, BVN/NIN requirements, thresholds.
- [ ] Whether you offer hosted KYC / BVN verification we should use instead of
      collecting documents ourselves.

## Safeguarding & settlement

- [ ] Where customer funds sit while held (provider wallet, pooled account,
      segregated account), and who is the legal custodian.
- [ ] Reconciliation artifacts you provide (settlement reports, webhooks,
      APIs) and their cadence.

## Commission & fees

- [ ] Our 10% platform commission on withdrawals is acceptable within your
      terms (we deduct before payout; provider fees disclosed separately).
- [ ] Your full fee schedule for collections, transfers, and payouts.

## Refunds, chargebacks, disputes

- [ ] Refund/chargeback process and timelines for card/bank deposits.
- [ ] Who bears chargeback liability; how we are notified (webhook + dashboard).
- [ ] Dispute-handling expectations for P2P transfers initiated on our side.

## Monitoring & reporting

- [ ] Transaction-monitoring / AML expectations placed on us (velocity rules,
      STR filing responsibility, record-keeping period).
- [ ] Reports we must file with you (suspicious activity, volume thresholds).

## Technical

- [ ] Sandbox/test credentials and test bank accounts provided.
- [ ] Webhook signing method (current docs URL + algorithm), retry policy.
- [ ] API versioning and breaking-change notice policy.

## Record-keeping

For each provider, file in `docs/` (never secrets in the repo):
`provider-<name>-approval-<date>.md` — who confirmed, their role, date, and a
verbatim copy of each answer above. **Milestone 11 stays blocked until this
file exists and all boxes are checked.**

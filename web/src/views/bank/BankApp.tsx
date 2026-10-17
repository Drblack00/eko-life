import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, EmptyState, Loading } from "../../components";
import {
  ApiError,
  api,
  bankApi,
  type BankBond,
  type BankOverview,
  type TermNote,
  type TransactionInfo,
} from "../../lib/api";
import { naira, type ActName, type You } from "../../game/types";
import { kindLabel } from "../home/LedgerSheet";
import { TopUpPacks } from "./TopUpPacks";
import "./BankApp.css";

/**
 * Phase 4 — Èkó Reserve: the bank phone app (original build, behavior
 * modeled on the reference audit's Bank screen).
 *
 * GAMEPLAY COINS ONLY — non-redeemable in-game currency. The cash wallet
 * stays inert; the Top-up button opens the existing coming-soon dialog.
 *
 * Sections: overview (balance, net worth, last receipt) · savings vault
 * (deposit/withdraw via the existing WS `bank` act) · bonds (buy + track)
 * · income tax (reuses the m10 tax estimate) · weekly upkeep bills ·
 * money history (GET /api/transactions).
 */

/** Preview interest/payout for a bond purchase (integer coin math). Pure. */
export function previewPayout(
  principal: number,
  rate: number
): { interest: number; payout: number } {
  const p = Math.max(0, Math.floor(Number(principal) || 0));
  const r = Math.max(0, Number(rate) || 0);
  const interest = Math.floor(p * r);
  return { interest, payout: p + interest };
}

/** Human label for a bond term, with server terms as the source. Pure. */
export function termOptionLabel(
  termDays: number,
  terms: Record<string, { rate: number; label: string }>
): string {
  const hit = terms[String(termDays)];
  if (hit) return hit.label;
  return `${termDays}-day`;
}

function tsOf(tx: TransactionInfo): number {
  if (typeof tx.ts === "number") return tx.ts;
  if (typeof tx.created_at === "number") {
    return tx.created_at < 1e12 ? tx.created_at * 1000 : tx.created_at;
  }
  return 0;
}

function Section({
  id,
  emoji,
  title,
  children,
}: {
  id: string;
  emoji: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="eko-bank__section glass glass--tint-dark" aria-label={title} id={id}>
      <h3 className="eko-bank__h">
        <span aria-hidden="true">{emoji}</span> {title}
      </h3>
      {children}
    </section>
  );
}

export function BankApp({
  token,
  you,
  sendAct,
  onTopUp,
}: {
  token: string;
  you: You;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Opens the existing inert top-up dialog (coming-soon, routes to Jobs). */
  onTopUp: () => void;
}) {
  const [ov, setOv] = useState<BankOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TransactionInfo[] | null>(null);
  const [bondAmt, setBondAmt] = useState("");
  const [termDays, setTermDays] = useState(14);
  const [bondBusy, setBondBusy] = useState(false);
  const [bondError, setBondError] = useState<string | null>(null);
  const [bondOk, setBondOk] = useState<string | null>(null);
  const [svAmt, setSvAmt] = useState("");
  // PORT-P2: money — term notes / credit / housing state.
  const [noteAmt, setNoteAmt] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteOk, setNoteOk] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditOk, setCreditOk] = useState<string | null>(null);
  const [houseBusy, setHouseBusy] = useState<string | null>(null);
  const [houseError, setHouseError] = useState<string | null>(null);
  const [houseOk, setHouseOk] = useState<string | null>(null);
  const [debtAmt, setDebtAmt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await bankApi.overview(token);
      setOv(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the bank.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    refresh();
    api
      .transactions(token, 100)
      .then((list) => setHistory(Array.isArray(list) ? list : []))
      .catch(() => setHistory([]));
  }, [refresh, token]);

  // The WS `bank` act (deposit/withdraw) pushes a fresh `you` snapshot —
  // re-pull the overview bundle when the authoritative balances move
  // (skipped on first mount — the initial fetch above already ran).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refresh();
  }, [refresh, you.money, you.savings]);

  const doBuyBond = useCallback(async () => {
    const amt = Math.floor(Number(bondAmt) || 0);
    setBondError(null);
    setBondOk(null);
    if (!ov) return;
    if (!(amt > 0)) {
      setBondError("Enter an amount first.");
      return;
    }
    if (amt < ov.bonds.min) {
      setBondError(`Bonds start at ${naira(ov.bonds.min)}.`);
      return;
    }
    if (!you.is_admin && amt > you.money) {
      setBondError("You don't have that much cash.");
      return;
    }
    setBondBusy(true);
    try {
      const res = await bankApi.buyBond(token, amt, termDays);
      setBondAmt("");
      const { interest, payout } = previewPayout(amt, res.bond.rate);
      setBondOk(
        `Bond #${res.bond.id} bought: ${naira(amt)} locked for ${res.bond.term_days} days → ${naira(payout)} (${naira(interest)} interest) at maturity.`
      );
      await refresh();
    } catch (e) {
      setBondError(e instanceof ApiError ? e.message : "Couldn't buy that bond.");
    } finally {
      setBondBusy(false);
    }
  }, [bondAmt, ov, refresh, termDays, token, you.is_admin, you.money]);

  const svAmount = Math.max(0, Math.floor(Number(svAmt) || 0));
  const depOk = svAmount > 0 && (you.is_admin || svAmount <= you.money);
  // PORT-P2: minimum withdrawal ₦1,000.
  const minWd = ov?.savingsTerms.minWithdraw ?? 1000;
  const wdOk = svAmount >= minWd && svAmount <= you.savings;
  const doSv = (op: "deposit" | "withdraw") => {
    sendAct("bank", { op, amount: svAmount });
    setSvAmt("");
  };

  // PORT-P2: money — term note / credit / housing actions.
  const doBuyNote = useCallback(async () => {
    const amt = Math.floor(Number(noteAmt) || 0);
    setNoteError(null);
    setNoteOk(null);
    if (!ov) return;
    if (!(amt > 0)) { setNoteError("Enter an amount first."); return; }
    if (amt < ov.termNotes.min) { setNoteError(`Term notes start at ${naira(ov.termNotes.min)}.`); return; }
    if (amt > ov.termNotes.max) { setNoteError(`One note caps at ${naira(ov.termNotes.max)}.`); return; }
    if (!you.is_admin && amt > you.money) { setNoteError("You don't have that much cash."); return; }
    setNoteBusy(true);
    try {
      const res = await bankApi.buyNote(token, amt);
      setNoteAmt("");
      setNoteOk(
        `Note #${res.note.id} bought: ${naira(amt)} locked for ${ov.termNotes.termDays} days → ${naira(res.note.payout)} (${naira(res.note.interest)} interest). Withdraw early and the interest is forfeited.`
      );
      await refresh();
    } catch (e) {
      setNoteError(e instanceof ApiError ? e.message : "Couldn't buy that note.");
    } finally {
      setNoteBusy(false);
    }
  }, [noteAmt, ov, refresh, token, you.is_admin, you.money]);

  const doEarlyWithdraw = useCallback(async (id: number) => {
    setNoteError(null);
    setNoteOk(null);
    setNoteBusy(true);
    try {
      const res = await bankApi.withdrawNoteEarly(token, id);
      setNoteOk(
        `Note #${id} withdrawn early: ${naira(res.principal)} back, ${naira(res.interestForfeited)} interest forfeited.`
      );
      await refresh();
    } catch (e) {
      setNoteError(e instanceof ApiError ? e.message : "Couldn't withdraw that note.");
    } finally {
      setNoteBusy(false);
    }
  }, [refresh, token]);

  const doCreditPay = useCallback(async (all: boolean) => {
    const amt = Math.floor(Number(payAmt) || 0);
    setCreditError(null);
    setCreditOk(null);
    if (!all && !(amt > 0)) { setCreditError("Enter an amount first."); return; }
    setCreditBusy(true);
    try {
      const res = all ? await bankApi.creditPayAll(token) : await bankApi.creditPay(token, amt);
      setPayAmt("");
      setCreditOk(
        res.cleared
          ? `Paid ${naira(res.paid)} — credit facility fully cleared. Well done.`
          : `Paid ${naira(res.paid)} — ${naira(res.balance)} left.`
      );
      await refresh();
    } catch (e) {
      setCreditError(e instanceof ApiError ? e.message : "Couldn't take that payment.");
    } finally {
      setCreditBusy(false);
    }
  }, [payAmt, refresh, token]);

  const doHouse = useCallback(async (key: string, fn: () => Promise<{ okMsg: string }>) => {
    setHouseBusy(key);
    setHouseError(null);
    setHouseOk(null);
    try {
      const r = await fn();
      setHouseOk(r.okMsg);
      await refresh();
    } catch (e) {
      setHouseError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setHouseBusy(null);
    }
  }, [refresh]);

  const terms = ov?.bonds.terms ?? {};
  const termKeys = Object.keys(terms)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const bondPreview = ov ? previewPayout(Math.floor(Number(bondAmt) || 0), terms[String(termDays)]?.rate ?? 0) : null;

  return (
    <div className="eko-bank">
      <div className="eko-bank__head">
        <h2 className="eko-bank__title">Èkó Reserve</h2>
        <p className="eko-bank__sub">
          Your money, working while you hustle. Gameplay coins only.
        </p>
      </div>

      {loading && <Loading message="Opening your vault…" />}
      {error && !loading && (
        <div className="eko-bank__error">
          <p>Couldn't load the bank: {error}</p>
          <Button
            size="md"
            onClick={() => {
              setLoading(true);
              setError(null);
              refresh();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {ov && (
        <>
          {/* ---------------- overview ---------------- */}
          <Section id="bank-overview" emoji="🏦" title="Overview">
            <div className="eko-bank__cards">
              <div className="eko-bank__card">
                <span className="eko-bank__label">Coin balance</span>
                <strong className="eko-bank__big">
                  {you.is_admin ? "∞ Unlimited" : naira(ov.balance)}
                </strong>
              </div>
              <div className="eko-bank__card">
                <span className="eko-bank__label">Net worth</span>
                <strong className="eko-bank__big">{naira(ov.netWorth)}</strong>
                <span className="eko-bank__hint" title="Net worth = wallet coins + savings + active bond principal">
                  wallet + savings + active bonds ⓘ
                </span>
              </div>
            </div>
            <div className="eko-bank__btnrow">
              <Button size="md" onClick={onTopUp} aria-label="Top up wallet">
                ➕ Top up
              </Button>
            </div>
            <div className="eko-bank__receipt">
              <span className="eko-bank__label">Last receipt</span>
              {ov.lastReceipt ? (
                <div className="eko-bank__receipt-row">
                  <span>{kindLabel(ov.lastReceipt.kind)}</span>
                  <strong
                    className={
                      Number(ov.lastReceipt.amount) >= 0
                        ? "eko-bank__in"
                        : "eko-bank__out"
                    }
                  >
                    {Number(ov.lastReceipt.amount) >= 0 ? "+" : "−"}
                    {naira(Math.abs(Number(ov.lastReceipt.amount)))}
                  </strong>
                </div>
              ) : (
                <span className="eko-bank__hint">No transactions yet.</span>
              )}
            </div>
          </Section>

          {/* ---------------- savings vault ---------------- */}
          <Section id="bank-savings" emoji="🔐" title="Savings vault">
            <div className="eko-bank__cards">
              <div className="eko-bank__card">
                <span className="eko-bank__label">Saved</span>
                <strong className="eko-bank__big">{naira(ov.savings)}</strong>
              </div>
              <div className="eko-bank__card">
                <span className="eko-bank__label">Interest this week</span>
                <strong className="eko-bank__big eko-bank__in">
                  +{naira(ov.interestWeek)}
                </strong>
              </div>
            </div>
            <p className="eko-bank__hint">
              Savings earn 0.5% every game week on the first{" "}
              {naira(ov.savingsTerms.cap)}. Interest builds by the minute and
              is credited daily. Minimum withdrawal {naira(minWd)}.
            </p>
            <label className="eko-bank__label" htmlFor="bank-sv-amount">
              Amount
            </label>
            <input
              id="bank-sv-amount"
              className="eko-bank__input"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="₦0"
              value={svAmt}
              onChange={(e) => setSvAmt(e.target.value)}
            />
            <div className="eko-bank__btnrow">
              <Button size="md" disabled={!depOk} onClick={() => doSv("deposit")}>
                Deposit{depOk ? ` ${naira(svAmount)}` : ""}
              </Button>
              <Button size="md" variant="accent" disabled={!wdOk} onClick={() => doSv("withdraw")}>
                Withdraw{wdOk ? ` ${naira(svAmount)}` : ""}
              </Button>
            </div>
          </Section>

          {/* ---------------- bonds ---------------- */}
          <Section id="bank-bonds" emoji="📜" title="Bonds">
            <p className="eko-bank__hint">
              Lock coins for a fixed term. Principal is locked until maturity —
              no early withdrawals.
            </p>
            <div className="eko-bank__form">
              <div className="eko-bank__field">
                <label className="eko-bank__label" htmlFor="bank-bond-amount">
                  Amount (min {naira(ov.bonds.min)})
                </label>
                <input
                  id="bank-bond-amount"
                  className="eko-bank__input"
                  type="number"
                  inputMode="numeric"
                  min={ov.bonds.min}
                  placeholder={naira(ov.bonds.min)}
                  value={bondAmt}
                  onChange={(e) => setBondAmt(e.target.value)}
                />
              </div>
              <div className="eko-bank__field">
                <label className="eko-bank__label" htmlFor="bank-bond-term">
                  Term
                </label>
                <select
                  id="bank-bond-term"
                  className="eko-bank__input"
                  value={termDays}
                  onChange={(e) => setTermDays(Number(e.target.value))}
                >
                  {termKeys.map((t) => (
                    <option key={t} value={t}>
                      {termOptionLabel(t, terms)}
                    </option>
                  ))}
                </select>
              </div>
              {bondPreview && Math.floor(Number(bondAmt) || 0) > 0 && (
                <p className="eko-bank__hint">
                  Matures to <strong>{naira(bondPreview.payout)}</strong> (
                  {naira(bondPreview.interest)} interest).
                </p>
              )}
              <Button size="md" disabled={bondBusy} onClick={doBuyBond}>
                {bondBusy ? "Buying…" : "Buy bond"}
              </Button>
              {bondError && <p className="eko-bank__error-text">{bondError}</p>}
              {bondOk && <p className="eko-bank__ok-text">{bondOk}</p>}
            </div>

            <h4 className="eko-bank__sub2">Active bonds ({ov.bonds.active.length})</h4>
            {ov.bonds.active.length === 0 ? (
              <p className="eko-bank__hint">No active bonds — your locked coins will show here.</p>
            ) : (
              <ol className="eko-bank__list">
                {ov.bonds.active.map((b: BankBond) => (
                  <li key={b.id} className="eko-bank__row">
                    <div className="eko-bank__meta">
                      <strong>
                        Bond #{b.id} · {naira(b.principal)}
                      </strong>
                      <span className="eko-bank__hint">
                        {termOptionLabel(b.term_days, terms)} · matures day{" "}
                        {b.matures_day}
                        {ov.day < b.matures_day
                          ? ` (${b.matures_day - ov.day}d left)`
                          : " (due — pays on the next day tick)"}
                      </span>
                    </div>
                    <div className="eko-bank__nums">
                      <span className="eko-bank__in">→ {naira(b.payout)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {ov.bonds.matured.length > 0 && (
              <>
                <h4 className="eko-bank__sub2">Matured ({ov.bonds.matured.length})</h4>
                <ol className="eko-bank__list">
                  {ov.bonds.matured.map((b: BankBond) => (
                    <li key={b.id} className="eko-bank__row">
                      <div className="eko-bank__meta">
                        <strong>
                          Bond #{b.id} · {naira(b.principal)}
                        </strong>
                        <span className="eko-bank__hint">
                          Paid out {naira(b.payout)} on day {b.matured_day ?? "—"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Section>

          {/* PORT-P2: term notes (2% / 7 days) */}
          <Section id="bank-term-notes" emoji="🧾" title="Term notes">
            <p className="eko-bank__hint">
              Lock coins for 7 days at 2%. {naira(ov.termNotes.min)} minimum,{" "}
              {naira(ov.termNotes.max)} maximum per note. Withdraw early and you
              get the principal back — the interest is forfeited.
            </p>
            <div className="eko-bank__form">
              <div className="eko-bank__field">
                <label className="eko-bank__label" htmlFor="bank-note-amount">
                  Amount ({naira(ov.termNotes.min)} – {naira(ov.termNotes.max)})
                </label>
                <input
                  id="bank-note-amount"
                  className="eko-bank__input"
                  type="number"
                  inputMode="numeric"
                  min={ov.termNotes.min}
                  max={ov.termNotes.max}
                  placeholder={naira(ov.termNotes.min)}
                  value={noteAmt}
                  onChange={(e) => setNoteAmt(e.target.value)}
                />
              </div>
              {Math.floor(Number(noteAmt) || 0) > 0 && (
                <p className="eko-bank__hint">
                  Matures to{" "}
                  <strong>
                    {naira(Math.floor(Number(noteAmt)) + Math.floor(Number(noteAmt) * ov.termNotes.rate))}
                  </strong>{" "}
                  ({naira(Math.floor(Number(noteAmt) * ov.termNotes.rate))} interest) in{" "}
                  {ov.termNotes.termDays} days.
                </p>
              )}
              <Button size="md" disabled={noteBusy} onClick={doBuyNote}>
                {noteBusy ? "Buying…" : "Buy 7-day note"}
              </Button>
              {noteError && <p className="eko-bank__error-text">{noteError}</p>}
              {noteOk && <p className="eko-bank__ok-text">{noteOk}</p>}
            </div>
            {ov.termNotes.active.length > 0 && (
              <>
                <h4 className="eko-bank__sub2">Active notes ({ov.termNotes.active.length})</h4>
                <ol className="eko-bank__list">
                  {ov.termNotes.active.map((n: TermNote) => (
                    <li key={n.id} className="eko-bank__row">
                      <div className="eko-bank__meta">
                        <strong>
                          Note #{n.id} · {naira(n.principal)}
                        </strong>
                        <span className="eko-bank__hint">
                          Matures day {n.matures_day}
                          {ov.day < n.matures_day
                            ? ` (${n.matures_day - ov.day}d left)`
                            : " (due — pays on the next day tick)"}{" "}
                          → {naira(n.payout)}
                        </span>
                      </div>
                      <div className="eko-bank__nums">
                        <Button
                          size="md"
                          variant="ghost"
                          disabled={noteBusy}
                          onClick={() => doEarlyWithdraw(n.id)}
                          title="Principal back now; the interest is forfeited."
                        >
                          Withdraw early
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Section>

          {/* PORT-P2: credit facility (LAPO repayment state, game coins only) */}
          <Section id="bank-credit" emoji="💳" title="Credit facility">
            {!ov.credit ? (
              <p className="eko-bank__hint">
                No credit balance. This facility is repayment-only — there is
                no borrowing desk here.
              </p>
            ) : (
              <>
                <div className="eko-bank__cards">
                  <div className="eko-bank__card">
                    <span className="eko-bank__label">Balance left</span>
                    <strong className="eko-bank__big eko-bank__out">{naira(ov.credit.balance)}</strong>
                  </div>
                  <div className="eko-bank__card">
                    <span className="eko-bank__label">Auto-debit</span>
                    <strong className="eko-bank__big">{naira(ov.credit.weeklyDue)}/wk</strong>
                    <span className="eko-bank__hint">{ov.credit.weeksLeft} weeks left</span>
                  </div>
                </div>
                <p className="eko-bank__hint">
                  The weekly debit collects automatically. Miss a week and the
                  balance carries over — no wahala, just pay.
                </p>
                <label className="eko-bank__label" htmlFor="bank-pay-amount">
                  Pay now (amount)
                </label>
                <input
                  id="bank-pay-amount"
                  className="eko-bank__input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="₦0"
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                />
                <div className="eko-bank__btnrow">
                  <Button size="md" disabled={creditBusy} onClick={() => doCreditPay(false)}>
                    {creditBusy ? "Paying…" : "Pay now"}
                  </Button>
                  <Button size="md" variant="accent" disabled={creditBusy} onClick={() => doCreditPay(true)}>
                    Pay it all ({naira(ov.credit.balance)})
                  </Button>
                </div>
                {creditError && <p className="eko-bank__error-text">{creditError}</p>}
                {creditOk && <p className="eko-bank__ok-text">{creditOk}</p>}
              </>
            )}
          </Section>

          {/* PORT-P2: housing ladder */}
          <Section id="bank-housing" emoji="🏠" title="Housing ladder">
            <p className="eko-bank__hint">
              Rent a home by the week, or buy it outright and never pay rent
              again. Rent is due every Saturday (day 7 of each game week) —
              miss it and it becomes rent debt. No eviction, no lockout, ever.
            </p>
            {ov.housing.rentDebt > 0 && (
              <>
                <div className="eko-bank__cards">
                  <div className="eko-bank__card">
                    <span className="eko-bank__label">Rent debt</span>
                    <strong className="eko-bank__big eko-bank__out">{naira(ov.housing.rentDebt)}</strong>
                  </div>
                </div>
                <label className="eko-bank__label" htmlFor="bank-debt-amount">
                  Clear rent debt (amount)
                </label>
                <input
                  id="bank-debt-amount"
                  className="eko-bank__input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="₦0"
                  value={debtAmt}
                  onChange={(e) => setDebtAmt(e.target.value)}
                />
                <div className="eko-bank__btnrow">
                  <Button
                    size="md"
                    disabled={houseBusy !== null}
                    onClick={() =>
                      doHouse("debt", async () => {
                        const amt = Math.floor(Number(debtAmt) || 0);
                        const r = await bankApi.housingPayDebt(token, amt);
                        setDebtAmt("");
                        return { okMsg: `Paid ${naira(r.paid)} — ${naira(r.rentDebt)} rent debt left.` };
                      })
                    }
                  >
                    {houseBusy === "debt" ? "Paying…" : "Pay debt"}
                  </Button>
                </div>
              </>
            )}
            <ol className="eko-bank__list">
              {ov.housing.homes.map((h) => {
                const owned = ov.housing.owned.includes(h.id);
                const current = ov.housing.current === h.id;
                return (
                  <li key={h.id} className="eko-bank__row">
                    <div className="eko-bank__meta">
                      <strong>
                        <span aria-hidden="true">{h.icon}</span> {h.name}
                        {current && <span className="eko-bank__pill">Home</span>}
                        {owned && <span className="eko-bank__pill">Owned</span>}
                      </strong>
                      <span className="eko-bank__hint">
                        {owned ? "No rent — yours." : `${naira(h.weeklyRent)}/week rent`} ·{" "}
                        {naira(h.buyPrice)} to buy
                      </span>
                    </div>
                    <div className="eko-bank__btnrow">
                      {!current && (
                        <Button
                          size="md"
                          variant="ghost"
                          disabled={houseBusy !== null}
                          onClick={() =>
                            doHouse(`move-${h.id}`, async () => {
                              await bankApi.housingMove(token, h.id);
                              return { okMsg: `Moved into ${h.name}. Rent starts next Saturday.` };
                            })
                          }
                        >
                          {houseBusy === `move-${h.id}` ? "…" : "Move in"}
                        </Button>
                      )}
                      {!owned && (
                        <Button
                          size="md"
                          disabled={houseBusy !== null || (!you.is_admin && h.buyPrice > you.money)}
                          onClick={() =>
                            doHouse(`buy-${h.id}`, async () => {
                              await bankApi.housingBuy(token, h.id);
                              return { okMsg: `${h.name} is yours — no more rent on it, ever.` };
                            })
                          }
                        >
                          {houseBusy === `buy-${h.id}` ? "…" : "Buy"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {houseError && <p className="eko-bank__error-text">{houseError}</p>}
            {houseOk && <p className="eko-bank__ok-text">{houseOk}</p>}
          </Section>

          {/* PORT-P2: top-up packs (structure only, purchase stubbed) */}
          <Section id="bank-topup" emoji="➕" title="Top up">
            <TopUpPacks />
          </Section>

          {/* ---------------- income tax ---------------- */}
          <Section id="bank-tax" emoji="🧾" title="Income tax">
            <p className="eko-bank__taxline">
              Estimated tax this week:{" "}
              <strong>{naira(ov.tax.bill)}</strong> (based on{" "}
              {naira(ov.tax.weekEarnings)} earnings)
            </p>
            <p className="eko-bank__hint">
              {ov.tax.bracket.label}
              {ov.tax.holiday
                ? " — tax holiday is active, nothing is owed."
                : ` · first ${naira(ov.tax.free)}/week tax-free, then ${(ov.tax.flatRate * 100).toFixed(1)}% flat on the rest.`}{" "}
              Collected automatically at the week boundary.
            </p>
          </Section>

          {/* ---------------- weekly bills ---------------- */}
          <Section id="bank-bills" emoji="💡" title="Weekly bills">
            <div className="eko-bank__cards">
              <div className="eko-bank__card">
                <span className="eko-bank__label">Upkeep / week</span>
                <strong className="eko-bank__big">{naira(ov.bills.weeklyBill)}</strong>
              </div>
              <div className="eko-bank__card">
                <span className="eko-bank__label">Arrears</span>
                <strong
                  className={`eko-bank__big ${ov.bills.arrears > 0 ? "eko-bank__out" : ""}`}
                >
                  {naira(ov.bills.arrears)}
                </strong>
              </div>
            </div>
            <p className="eko-bank__hint">
              Week {ov.bills.currentWeek + 1} ends on game day {ov.bills.weekEndsDay} —
              the bill is deducted then. Bill = ₦1,000 base + 0.1% of owned
              property price per week.
            </p>
            {ov.bills.arrears > 0 && (
              <p className="eko-bank__hint">
                Arrears are capped at {ov.bills.capWeeks} weeks of bills (
                {naira(ov.bills.arrearsCap)}). No interest on arrears, no
                lockouts — the next weekly tick pays what it can.
              </p>
            )}
          </Section>

          {/* PORT-P2: credibility score (record only) */}
          <Section id="bank-credibility" emoji="🌱" title="Credibility">
            <div className="eko-bank__cards">
              <div className="eko-bank__card">
                <span className="eko-bank__label">Score</span>
                <strong className="eko-bank__big">{ov.credibility.total}/100</strong>
              </div>
            </div>
            <ol className="eko-bank__list">
              {ov.credibility.parts.map((p) => (
                <li key={p.key} className="eko-bank__row">
                  <div className="eko-bank__meta">
                    <strong>{p.label}</strong>
                    <span className="eko-bank__hint">{p.detail}</span>
                  </div>
                  <div className="eko-bank__nums">
                    <span>
                      {p.score}/{p.max}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="eko-bank__hint">
              This score is a record only — it never limits what you can send
              or receive. Build it by trading with players, keeping streaks,
              and running jobs or a business.
            </p>
          </Section>

          {/* ---------------- money history ---------------- */}
          <Section id="bank-history" emoji="📒" title="Money history">
            {history === null ? (
              <Loading message="Loading your ledger…" />
            ) : history.length === 0 ? (
              <EmptyState
                emoji="💸"
                title="No transactions yet"
                body="No transactions yet — go hustle!"
              />
            ) : (
              <ol className="eko-bank__list">
                {history.map((tx) => {
                  const amount = Math.round(Number(tx.amount) || 0);
                  const ts = tsOf(tx);
                  return (
                    <li key={tx.id} className="eko-bank__row">
                      <div className="eko-bank__meta">
                        <strong>{kindLabel(tx.kind)}</strong>
                        <span className="eko-bank__hint">
                          {ts > 0
                            ? new Date(ts).toLocaleString("en-NG", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""}
                        </span>
                      </div>
                      <div className="eko-bank__nums">
                        <span className={amount >= 0 ? "eko-bank__in" : "eko-bank__out"}>
                          {amount >= 0 ? "+" : "−"}
                          {naira(Math.abs(amount))}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

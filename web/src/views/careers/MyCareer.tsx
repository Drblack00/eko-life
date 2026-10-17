import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Dialog, EmptyState } from "../../components";
import { careersApi, naira, type CareerStatus, type PendingEvent } from "./api";
import "./careers.css";

export interface MyCareerProps {
token: string;
  /** raw WS sender for shift_start clock-in, e.g. (msg) => socket.send(...) */
  send: (msg: Record<string, unknown>) => void;
  /** called after apply so the parent can switch tabs */
  onBrowse?: () => void;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function EventCard({
  event,
  onRespond,
  busy,
}: {
  event: PendingEvent;
  onRespond: (choiceId: string) => void;
  busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const left = event.expiresAt - now;
  return (
    <Card className="p3-event" elevated>
      <div className="p3-event__head">
        <span aria-hidden="true">🚨</span>
        <div>
          <div className="p3-event__title">{event.title}</div>
          <div className="p3-event__timer" role="timer">
            {left > 0 ? `${fmtCountdown(left)} to respond` : "Slipping away…"}
          </div>
        </div>
      </div>
      <p className="p3-event__flavor">{event.flavor}</p>
      <div className="p3-event__choices">
        {event.choices.map((c) => (
          <Button
            key={c.id}
            variant="primary"
            disabled={busy}
            onClick={() => onRespond(c.id)}
            className="p3-event__choice"
          >
            {c.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

export function MyCareer({ token, send, onBrowse }: MyCareerProps) {
  const [status, setStatus] = useState<CareerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const st = await careersApi.me(token);
      setStatus(st);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your career.");
    }
  }, [token]);

  useEffect(() => {
    void reload();
    // Poll while a shift or event is live — the tick pushes state changes.
    pollRef.current = window.setInterval(() => void reload(), 20000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const iv = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(iv);
  }, [toast]);

  const mutate = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      if (okMsg) setToast(okMsg);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !status) {
    return (
      <div className="p3-wrap">
        <EmptyState emoji="💼" title="Career unavailable" action={<p className="p3-note">{error}</p>} />
      </div>
    );
  }
  if (!status) {
    return (
      <div className="p3-wrap">
        <EmptyState emoji="💼" title="Loading your career…" />
      </div>
    );
  }
  if (!status.employed) {
    return (
      <div className="p3-wrap">
        {toast && <div className="p3-toast" role="status">{toast}</div>}
        <EmptyState
          emoji="💼"
          title="No career yet"
          action={
            <>
              <p className="p3-note">Pick one of 27 careers and climb 5 ranks to the top.</p>
              <Button variant="primary" onClick={onBrowse}>
                Browse careers
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const st = status;
  const perf = st.performance ?? null;

  return (
    <div className="p3-wrap">
      {toast && <div className="p3-toast" role="status">{toast}</div>}

      {/* Current career + rank */}
      <Card className="p3-hero" elevated>
        <div className="p3-hero__head">
          <span className="p3-hero__icon" aria-hidden="true">{st.careerIcon ?? "💼"}</span>
          <div>
            <div className="p3-hero__name">{st.careerName}</div>
            <div className="p3-hero__rank">
              {st.rankTitle} · Rank {st.rank} of {st.rankOf}
            </div>
          </div>
        </div>
        <dl className="p3-rows">
          <div>
            <dt>Pay</dt>
            <dd>{naira(st.payPerShift ?? 0)}/shift</dd>
          </div>
          <div>
            <dt>Schedule</dt>
            <dd>{st.schedule}</dd>
          </div>
          <div>
            <dt>Shifts at rank</dt>
            <dd>
              {st.shiftsAtRank}/{st.shiftsNeeded}
            </dd>
          </div>
        </dl>

        {/* Weekly schedule strip */}
        <div className="p3-strip" aria-label="Weekly schedule">
          {st.scheduleStrip?.map((d) => (
            <span key={d.day} className={`p3-strip__day${d.work ? " p3-strip__day--work" : ""}`}>
              {d.day[0]}
            </span>
          ))}
        </div>
        {st.dayOffToday && !st.onShift && (
          <p className="p3-note p3-note--off">🌴 Day off today — enjoy it. Shifts resume on your next workday.</p>
        )}

        {/* Performance */}
        {perf !== null && (
          <div className="p3-perf">
            <div className="p3-perf__head">
              <span>Shift performance</span>
              <strong>{perf}%</strong>
            </div>
            <div className="p3-perf__bar" role="progressbar" aria-valuenow={perf} aria-valuemin={0} aria-valuemax={100} aria-label="Shift performance">
              <div className="p3-perf__fill" style={{ width: `${perf}%` }} />
            </div>
            <p className="p3-note">End the shift at 100% with enough shifts banked to unlock promotion.</p>
          </div>
        )}

        {/* Next rank + promotion */}
        {st.nextRank ? (
          <div className="p3-next">
            <div>
              <div className="p3-next__label">Next rank</div>
              <div className="p3-next__title">
                {st.nextRank.title} · {naira(st.nextRank.payPerShift)}/shift
              </div>
              <div className="p3-note">
                Needs {st.nextRank.shiftsNeeded} shifts at this rank + one shift ending at 100%.
              </div>
            </div>
            {st.promotionReady && (
              <Button variant="accent" disabled={busy} onClick={() => void mutate(() => careersApi.promote(token), "🎉 Promoted!")}>
                Promote
              </Button>
            )}
          </div>
        ) : (
          <p className="p3-note">👑 Top of the ladder — nothing above you in {st.careerName}.</p>
        )}

        {/* Auto-start toggle */}
        <label className="p3-auto">
          <input
            type="checkbox"
            checked={!!st.autoStart}
            disabled={busy}
            onChange={(e) => void mutate(() => careersApi.auto(token, e.target.checked))}
          />
          <span>⏰ Go automatically — start my shift on workdays</span>
        </label>

        <div className="p3-actions">
          {!st.onShift && !st.dayOffToday && st.shiftRoleId && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => send({ t: "act", a: "shift_start", job: st.shiftRoleId })}
            >
              ⏰ Clock in ({naira(st.payPerShift ?? 0)})
            </Button>
          )}
          {st.onShift && st.shiftEndsAt && (
            <span className="p3-note">
              On shift — ends {new Date(st.shiftEndsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button variant="ghost" onClick={() => setConfirmQuit(true)}>
            Quit career
          </Button>
        </div>
      </Card>

      {/* Live work event (the mini-game) */}
      {st.pendingEvent && (
        <EventCard
          event={st.pendingEvent}
          busy={busy}
          onRespond={(choiceId) =>
            void mutate(() => careersApi.respond(token, st.pendingEvent!.id, choiceId))
          }
        />
      )}

      {/* Rank ladder */}
      <Card className="p3-ladder">
        <h3 className="p3-h">🪜 {st.careerName} ladder</h3>
        <ol className="p3-ladder__list">
          {st.ladder?.map((r, i) => (
            <li key={r.title} className={r.current ? "p3-ladder__item--current" : ""}>
              <span className="p3-ladder__rank">{i + 1}</span>
              <span className="p3-ladder__body">
                <strong>{r.title}</strong>
                {r.current && <em> — you are here</em>}
                <small>
                  {naira(r.payPerShift)}/shift · {r.minShifts} shifts to promote
                </small>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Dialog open={confirmQuit} onClose={() => setConfirmQuit(false)} title="Quit career?">
        <p className="p3-dialog__text">
          Quitting <strong>{st.careerName}</strong> wipes your rank progress. If you join
          another career you start again at rank 1.
        </p>
        <div className="p3-dialog__actions">
          <Button variant="ghost" onClick={() => setConfirmQuit(false)}>
            Keep my career
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setConfirmQuit(false);
              void mutate(() => careersApi.quit(token), "Career quit.");
            }}
          >
            Quit
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  eventsApi,
  type EventAttendee,
  type EventDayGroup,
  type EventDetail,
  type EventSeason,
  type EventSummary,
} from "../../lib/api";
import "./EventsApp.css";

/** Format big counts like 1208 -> "1,208". */
function formatCount(n: number): string {
  return Math.floor(Number(n) || 0).toLocaleString("en-NG");
}

function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

/**
 * Live ticking countdown. Counts down to `targetEpoch` (epoch seconds);
 * re-renders every second. Exported for tests.
 */
export function useCountdown(targetEpoch: number | null) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (targetEpoch == null) return;
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [targetEpoch]);
  const remaining = targetEpoch == null ? 0 : Math.max(0, targetEpoch - now);
  return {
    d: Math.floor(remaining / 86400),
    h: Math.floor((remaining % 86400) / 3600),
    m: Math.floor((remaining % 3600) / 60),
    s: remaining % 60,
    done: remaining <= 0,
  };
}

/** Cycle of token-driven avatar circle backgrounds. */
const AVA_BG = [
  "var(--accent)",
  "var(--primary)",
  "var(--lagoon-500)",
  "var(--danger)",
];

function AvatarStack({ attendees, total }: { attendees: EventAttendee[]; total: number }) {
  const shown = attendees.slice(0, 4);
  const rest = Math.max(0, total - shown.length);
  return (
    <span className="eko-events__avas">
      {shown.map((a, i) => (
        <span
          key={a.username}
          className="eko-events__ava"
          style={{ background: AVA_BG[i % AVA_BG.length] }}
          title={a.username}
        >
          {a.initials}
        </span>
      ))}
      {rest > 0 && (
        <span
          className="eko-events__ava eko-events__ava--rest"
          title={`${rest} more`}
        >
          +{formatCount(rest)}
        </span>
      )}
    </span>
  );
}

function Countdown({ target, live }: { target: number; live: boolean }) {
  const { d, h, m, s, done } = useCountdown(target);
  return (
    <div className="eko-events__countwrap">
      {live && <div className="eko-events__livenote">🔴 LIVE NOW · ENDS IN</div>}
      <div className="eko-events__count" role="timer" aria-label="Event countdown">
        <div className="eko-events__cell">
          <b>{pad2(d)}</b>
          <span>DAYS</span>
        </div>
        <div className="eko-events__cell">
          <b>{pad2(h)}</b>
          <span>HRS</span>
        </div>
        <div className="eko-events__cell">
          <b>{pad2(m)}</b>
          <span>MIN</span>
        </div>
        <div className="eko-events__cell">
          <b>{pad2(s)}</b>
          <span>SEC</span>
        </div>
      </div>
      {done && !live && (
        <div className="eko-events__livenote">🎬 It's on right now!</div>
      )}
    </div>
  );
}

function EventRow({ event, onOpen }: { event: EventSummary; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`eko-events__ev${event.isLive ? " eko-events__ev--live" : ""}`}
      onClick={() => onOpen(event.id)}
    >
      <span className="eko-events__ic" aria-hidden="true">
        {event.emoji}
      </span>
      <span className="eko-events__inf">
        <b>
          {event.title}
          {event.isLive && <span className="eko-events__livepill">● LIVE</span>}
        </b>
        <span>
          {event.venue} · {event.timeLabel}
        </span>
      </span>
    </button>
  );
}

function SeasonBanner({ season }: { season: EventSeason }) {
  return (
    <div className="eko-events__season">
      <div className="eko-events__season-tag">
        {season.emoji} SEASON · {season.window}
      </div>
      <h3>{season.title}</h3>
      {season.blurb && <div className="eko-events__season-blurb">{season.blurb}</div>}
    </div>
  );
}

function DetailView({
  event,
  attendees,
  onBack,
  onRsvp,
  busy,
}: {
  event: EventDetail;
  attendees: EventAttendee[];
  onBack: () => void;
  onRsvp: (status: "going" | "remind" | null) => void;
  busy: boolean;
}) {
  const going = event.myStatus === "going";
  const reminded = event.myStatus === "remind";
  const target = event.isLive ? event.endsAt : event.startsAt;
  return (
    <div className="eko-events__detail">
      <button
        type="button"
        className="eko-events__back"
        onClick={onBack}
        aria-label="Back to events"
      >
        ← All events
      </button>
      <div className="eko-events__hero">
        <span className="eko-events__hero-big" aria-hidden="true">
          {event.emoji}
        </span>
        <div className="eko-events__hero-ti">
          <b>
            {event.title}
            {event.isLive && <span className="eko-events__livepill">● LIVE</span>}
          </b>
          <span>
            {event.venue} · {event.timeLabel}
          </span>
        </div>
      </div>
      <Countdown target={target} live={event.isLive} />
      <div className="eko-events__sec">Details</div>
      {event.details.map((d, i) => (
        <div key={i} className="eko-events__drow">
          <span aria-hidden="true">{d.icon}</span>
          {/* Seed-trusted rich copy (server-seeded <b> markup only). */}
          <span className="eko-events__drow-t" dangerouslySetInnerHTML={{ __html: d.rich }} />
        </div>
      ))}
      <div className="eko-events__sec">Who's going</div>
      <div className="eko-events__att">
        <AvatarStack attendees={attendees} total={event.attendees} />
        <span className="eko-events__going">{formatCount(event.attendees)} going</span>
      </div>
      <div className="eko-events__cta">
        <button
          type="button"
          className={`eko-events__ghost${reminded ? " eko-events__ghost--on" : ""}`}
          disabled={busy}
          onClick={() => onRsvp(reminded ? null : "remind")}
        >
          {reminded ? "✓ Reminder set" : "🔔 Remind me"}
        </button>
        <button
          type="button"
          className={`eko-events__join${going ? " eko-events__join--on" : ""}`}
          disabled={busy}
          onClick={() => onRsvp(going ? null : "going")}
        >
          {going ? "✓ Going" : "Join event"}
        </button>
      </div>
    </div>
  );
}

/**
 * Events — the Live Events Calendar phone app.
 * Day-grouped agenda timeline (season banner on top, live events pulse),
 * tap-through detail with a live ticking countdown, details, who's going,
 * and Join / Remind RSVP buttons. Data: /api/events.
 */
export function EventsApp({ token }: { token: string }) {
  const [days, setDays] = useState<EventDayGroup[]>([]);
  const [seasons, setSeasons] = useState<EventSeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await eventsApi.list(token);
      setDays(r.days);
      setSeasons(r.seasons);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load events.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEvent = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetailBusy(true);
      try {
        const r = await eventsApi.detail(token, id);
        setDetail(r.event);
        setAttendees(r.attendees);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't open that event.");
        setSelectedId(null);
      } finally {
        setDetailBusy(false);
      }
    },
    [token]
  );

  const rsvp = useCallback(
    async (status: "going" | "remind" | null) => {
      if (!detail) return;
      setRsvpBusy(true);
      try {
        if (status === null) {
          await eventsApi.cancelRsvp(token, detail.id);
        } else {
          await eventsApi.rsvp(token, detail.id, status);
        }
        const r = await eventsApi.detail(token, detail.id);
        setDetail(r.event);
        setAttendees(r.attendees);
        // keep the timeline row in sync
        setDays((prev) =>
          prev.map((g) => ({
            ...g,
            events: g.events.map((e) =>
              e.id === detail.id
                ? { ...e, attendees: r.event.attendees, myStatus: r.event.myStatus }
                : e
            ),
          }))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "RSVP didn't go through.");
      } finally {
        setRsvpBusy(false);
      }
    },
    [detail, token]
  );

  const list = useMemo(
    () => (
      <>
        {seasons.map((s) => (
          <SeasonBanner key={s.tag} season={s} />
        ))}
        <div className="eko-events__tl">
          {days.map((day) => (
            <div key={day.key}>
              <div className="eko-events__day">{day.label}</div>
              {day.events.map((ev) => (
                <EventRow key={ev.id} event={ev} onOpen={openEvent} />
              ))}
            </div>
          ))}
        </div>
      </>
    ),
    [days, seasons, openEvent]
  );

  return (
    <div className="eko-events">
      <header className="eko-events__hd">
        <div>
          <h2 className="eko-events__title">Events 🗓️</h2>
          <p className="eko-events__sub">What's popping in Lagos</p>
        </div>
        <button
          type="button"
          className="eko-events__refresh"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh events"
        >
          ⟳
        </button>
      </header>
      {loading && !selectedId && <p className="eko-events__msg">Loading events…</p>}
      {error && <p className="eko-events__err">{error}</p>}
      {!loading && !selectedId && days.length === 0 && !error && (
        <p className="eko-events__msg">No events on the calendar right now.</p>
      )}
      {!selectedId && list}
      {selectedId && detailBusy && !detail && (
        <p className="eko-events__msg">Loading event…</p>
      )}
      {selectedId && detail && (
        <DetailView
          event={detail}
          attendees={attendees}
          onBack={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          onRsvp={rsvp}
          busy={rsvpBusy}
        />
      )}
    </div>
  );
}

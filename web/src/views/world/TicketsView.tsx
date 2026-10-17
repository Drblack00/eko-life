import { useState } from "react";
import { worldApi } from "../../lib/api";
import { Button } from "../../components/Button";
import {
  WorldHead, WorldNotice, WorldLoading, WorldTabs, useWorldState, naira, countdown,
} from "./worldShared";

/**
 * Tickets — browse ticketed events (free to ₦7,500+), buy a ticket,
 * see your tickets, or list your own event (organizer keeps the
 * ticket price minus 5% + ₦100 per paid ticket).
 */
type Tab = "browse" | "mine" | "create";

export function TicketsView({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("browse");
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    async (t) => {
      const [ev, mine] = await Promise.all([worldApi.ticketEvents(t), worldApi.myTickets(t)]);
      return { events: ev.events, feeNote: ev.feeNote, mine: mine.tickets };
    },
    token
  );
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [price, setPrice] = useState("2000");
  const [capacity, setCapacity] = useState("200");
  const [daysOut, setDaysOut] = useState("7");

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="🎟️ Tickets" />
        <WorldNotice kind="error">{error ?? "Couldn't load events."}</WorldNotice>
      </div>
    );
  }

  const buy = (eventId: number) =>
    run(async () => {
      await worldApi.ticketBuy(token, eventId);
    }, "Ticket secured! 🎟️");

  const create = () =>
    run(async () => {
      if (!title.trim()) throw new Error("Name your event.");
      const days = Math.max(1, Math.min(90, Number(daysOut) || 7));
      await worldApi.ticketCreate(token, {
        title: title.trim(),
        venue: venue.trim(),
        price: Math.max(0, Math.floor(Number(price) || 0)),
        capacity: Math.max(1, Math.min(50000, Math.floor(Number(capacity) || 200))),
        startsAt: Date.now() + days * 86400000,
      });
      setTitle(""); setVenue("");
      setTab("browse");
    }, "Event listed! 🎉");

  return (
    <div className="world-app">
      <WorldHead title="🎟️ Tickets" sub="Owambes, concerts, demo days — grab a seat." />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>
      <WorldTabs
        tabs={[
          { id: "browse", label: "🎪 Browse" },
          { id: "mine", label: "🎫 My tickets" },
          { id: "create", label: "➕ Host event" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "browse" && (
        <>
          <p className="world-muted">{state.feeNote}</p>
          {state.events.length === 0 && <WorldNotice>No upcoming ticketed events.</WorldNotice>}
          {state.events.map((e) => (
            <div key={e.id} className="world-card">
              <div className="world-row">
                <span className="grow">
                  <strong>{e.title}</strong>
                  <br />
                  <span className="world-muted">📍 {e.venue || "TBA"} · in {countdown(e.startsAt - Date.now())}</span>
                </span>
                <span className="world-price">{e.price === 0 ? "FREE" : naira(e.price)}</span>
              </div>
              <div className="world-row">
                <span className="world-muted">{e.sold}/{e.capacity} claimed</span>
                {e.hasTicket ? (
                  <span className="world-pill world-pill--live">🎫 Ticket held</span>
                ) : e.sold >= e.capacity ? (
                  <span className="world-pill world-pill--bad">Sold out</span>
                ) : (
                  <Button onClick={() => buy(e.id)} disabled={busy}>
                    {busy ? "…" : e.price === 0 ? "Claim free" : `Buy · ${naira(e.price)}`}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "mine" && (
        <>
          {state.mine.length === 0 && <WorldNotice>No tickets yet — go browse something fun.</WorldNotice>}
          {state.mine.map((t) => (
            <div key={t.id} className="world-card">
              <h3>🎫 {t.title}</h3>
              <p className="sub">📍 {t.venue || "TBA"} · {new Date(t.startsAt).toLocaleString("en-NG")}</p>
              <span className="world-muted">Paid {t.pricePaid === 0 ? "nothing (free)" : naira(t.pricePaid)}</span>
            </div>
          ))}
        </>
      )}

      {tab === "create" && (
        <div className="world-card">
          <h3>➕ Host your event</h3>
          <p className="sub">You keep the ticket price minus 5% + ₦100 per paid ticket.</p>
          <label className="world-label" htmlFor="ev-title">Event name</label>
          <input id="ev-title" className="world-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rooftop Amapiano Night" />
          <label className="world-label" htmlFor="ev-venue">Venue</label>
          <input id="ev-venue" className="world-input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Landmark Beach" />
          <label className="world-label" htmlFor="ev-price">Ticket price (₦, 0 = free)</label>
          <input id="ev-price" className="world-input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          <label className="world-label" htmlFor="ev-cap">Capacity</label>
          <input id="ev-cap" className="world-input" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <label className="world-label" htmlFor="ev-days">Days from now</label>
          <input id="ev-days" className="world-input" inputMode="numeric" value={daysOut} onChange={(e) => setDaysOut(e.target.value)} />
          <div className="world-btnrow">
            <Button onClick={create} disabled={busy}>{busy ? "…" : "List event"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

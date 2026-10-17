// PORT-P4: social — house invites panel (Friends page section).
//
// Per-player house link (original /v/<token> scheme), 5-guest cap,
// knock → approve/decline. Explicit: NO referral rewards — inviting
// is hospitality, not a payout. Game-money only throughout.
import { useCallback, useEffect, useState } from "react";
import { ApiError, socialApi, type HouseInviteInfo, type HouseKnock } from "../../lib/api";
import { Button, Card, EmptyState, useToast } from "../../components";
import "./Social.css";

export function HousePanel({ token }: { token: string }) {
  const { toast } = useToast();
  const [invite, setInvite] = useState<HouseInviteInfo | null>(null);
  const [pending, setPending] = useState<HouseKnock[]>([]);
  const [guests, setGuests] = useState<HouseKnock[]>([]);
  const [cap, setCap] = useState(5);
  const [acting, setActing] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      try {
        const [inv, kn] = await Promise.all([
          socialApi.houseInvite(token),
          socialApi.knocks(token),
        ]);
        setInvite(inv);
        setPending(kn.pending);
        setGuests(kn.guests);
        setCap(kn.guest_cap);
      } catch (err) {
        if (!silent) {
          toast(
            err instanceof ApiError ? err.message : "Couldn't load house invites.",
            "error"
          );
        }
      }
    },
    [token, toast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const copyLink = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      toast("House link copied — post it anywhere.", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copy failed — long-press the link instead.", "error");
    }
  };

  const decide = async (knock: HouseKnock, approve: boolean) => {
    setActing(knock.id);
    try {
      if (approve) await socialApi.approveKnock(token, knock.id);
      else await socialApi.declineKnock(token, knock.id);
      toast(
        approve ? `@${knock.visitor_username} is in. 🎉` : "Knock declined.",
        approve ? "success" : "info"
      );
      await load(true);
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Couldn't update the knock.",
        "error"
      );
    } finally {
      setActing(null);
    }
  };

  return (
    <section aria-label="House invites" className="eko-fpage__section">
      <h3 className="eko-fpage__h">🏠 House invites</h3>
      <Card className="eko-fpage__invite">
        <p className="eko-fpage__invite-text">
          Share your personal house link — anyone who opens it knocks on
          your door, and you decide who enters. Fits {cap} guests. No
          rewards for inviting, just good company. 😎
        </p>
        {invite ? (
          <>
            <div className="eko-fpage__linkrow">
              <code className="eko-fpage__link">{invite.link}</code>
            </div>
            <div className="eko-fpage__invite-acts">
              <Button size="md" variant="accent" onClick={() => void copyLink()}>
                {copied ? "✓ Copied!" : "⧉ Copy link"}
              </Button>
              <Button size="md" variant="ghost" onClick={() => void load()}>
                🔄 Refresh knocks
              </Button>
            </div>
            <p className="eko-fpage__joined" aria-live="polite">
              <strong>{guests.length}</strong>/{cap} guests in
            </p>
          </>
        ) : (
          <p>Preparing your house link…</p>
        )}
      </Card>

      {pending.length > 0 && (
        <div className="eko-house__knocks">
          <h4 className="eko-house__sub">🚪 Knocking now ({pending.length})</h4>
          {pending.map((k) => (
            <Card key={k.id} className="eko-fpage__row">
              <span className="eko-social__avatar" aria-hidden="true">
                {k.visitor_username.slice(0, 1).toUpperCase()}
              </span>
              <div className="eko-fpage__who">
                <strong>@{k.visitor_username}</strong>
                <span className="eko-fpage__meta">wants to visit your house</span>
              </div>
              <div className="eko-fpage__acts">
                <Button
                  size="md"
                  variant="accent"
                  disabled={acting === k.id}
                  onClick={() => void decide(k, true)}
                >
                  Let in
                </Button>
                <Button
                  size="md"
                  variant="ghost"
                  disabled={acting === k.id}
                  onClick={() => void decide(k, false)}
                >
                  Not now
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {guests.length > 0 && (
        <div className="eko-house__knocks">
          <h4 className="eko-house__sub">🛋️ Current guests</h4>
          {guests.map((g) => (
            <Card key={g.id} className="eko-fpage__row">
              <span className="eko-social__avatar" aria-hidden="true">
                {g.visitor_username.slice(0, 1).toUpperCase()}
              </span>
              <div className="eko-fpage__who">
                <strong>@{g.visitor_username}</strong>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pending.length === 0 && guests.length === 0 && (
        <EmptyState
          emoji="🚪"
          title="Nobody knocking yet"
          body="Share your house link on X or WhatsApp — visitors knock, you let them in."
        />
      )}
    </section>
  );
}

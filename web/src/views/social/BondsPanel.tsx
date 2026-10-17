// PORT-P4: social — closeness bonds panel (Friends page section).
//
// Closeness grows from real interaction: DMs exchanged, hangouts, and
// gifts (game coins). At closeness 50 you can add someone as family;
// at 150 you can start dating. Both need the other player's accept.
// Original flavor, original thresholds.
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  socialApi,
  type BondInfo,
  type GiftItem,
} from "../../lib/api";
import { Button, Card, Dialog, EmptyState, useToast } from "../../components";
import "./Social.css";

function BondBadges({ bond }: { bond: BondInfo }) {
  return (
    <span className="eko-bond__badges">
      {bond.family === "family" && <span title="Family">👪</span>}
      {bond.dating === "dating" && <span title="Dating">💞</span>}
      {bond.family === "pending" && <span title="Family request pending">⏳👪</span>}
      {bond.dating === "pending" && <span title="Dating request pending">⏳💞</span>}
      {/* PORT-P4: social — the other player hides relationships */}
      {(bond.family === "hidden" || bond.dating === "hidden") && (
        <span title="This player keeps relationships private">🔒</span>
      )}
    </span>
  );
}

function BondDetail({
  bond,
  token,
  onChanged,
}: {
  bond: BondInfo;
  token: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [shelf, setShelf] = useState<GiftItem[]>([]);

  const errMsg = (err: unknown, fallback: string) =>
    err instanceof ApiError ? err.message : fallback;

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg, "success");
      onChanged();
    } catch (err) {
      toast(errMsg(err, "Something went wrong."), "error");
    } finally {
      setBusy(false);
    }
  };

  const openGifts = async () => {
    try {
      const r = await socialApi.giftShelf(token);
      setShelf(r.gifts);
      setGiftOpen(true);
    } catch (err) {
      toast(errMsg(err, "Couldn't load the gift shelf."), "error");
    }
  };

  const sendGift = (gift: GiftItem) =>
    run(
      () => socialApi.sendGift(token, bond.other_username, gift.id).then(() => undefined),
      `${gift.emoji} Sent ${gift.name} to @${bond.other_username}.`
    ).finally(() => setGiftOpen(false));

  return (
    <Card className="eko-bond__detail">
      <div className="eko-bond__head">
        <strong>
          @{bond.other_username} <BondBadges bond={bond} />
        </strong>
        <span className="eko-bond__score">Closeness {bond.score}</span>
      </div>
      <div className="eko-bond__counts">
        <span>💬 {bond.dm_count} DMs</span>
        <span>🤝 {bond.hangout_count} hangouts</span>
        <span>🎁 {bond.gift_count} gifts</span>
      </div>
      <div className="eko-bond__bar" aria-hidden="true">
        <div
          className="eko-bond__bar-fill"
          style={{ width: `${Math.min(100, (bond.score / 150) * 100)}%` }}
        />
      </div>
      <p className="eko-chat__hint">
        {bond.can_family
          ? "👪 Family unlocked — you can add each other as family."
          : `👪 Family unlocks at closeness 50 (${Math.max(0, 50 - bond.score)} to go).`}{" "}
        {bond.can_date
          ? "💞 Dating unlocked."
          : `💞 Dating unlocks at closeness 150 (${Math.max(0, 150 - bond.score)} to go).`}
      </p>
      <div className="eko-bond__acts">
        <Button
          size="md"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(
              () => socialApi.hangout(token, bond.other_username),
              `Hung out with @${bond.other_username}. Closeness +15.`
            )
          }
        >
          🤝 Hang out
        </Button>
        <Button size="md" variant="ghost" disabled={busy} onClick={() => void openGifts()}>
          🎁 Send gift
        </Button>
        {bond.family === "none" && (
          <Button
            size="md"
            variant="ghost"
            disabled={busy || !bond.can_family}
            onClick={() =>
              void run(
                () => socialApi.familyRequest(token, bond.other_username),
                `Family request sent to @${bond.other_username}.`
              )
            }
            title={bond.can_family ? "Add as family" : "Reach closeness 50 first"}
          >
            👪 Add as family
          </Button>
        )}
        {bond.family === "pending" && bond.family_request_from !== bond.other_id && (
          <Button
            size="md"
            variant="accent"
            disabled={busy}
            onClick={() =>
              void run(
                () => socialApi.familyRespond(token, bond.other_username, true),
                `@${bond.other_username} is now family. 👪`
              )
            }
          >
            Accept family
          </Button>
        )}
        {bond.dating === "none" && (
          <Button
            size="md"
            variant="ghost"
            disabled={busy || !bond.can_date}
            onClick={() =>
              void run(
                () => socialApi.datingRequest(token, bond.other_username),
                `You asked @${bond.other_username} out. 💞`
              )
            }
            title={bond.can_date ? "Ask out" : "Reach closeness 150 first"}
          >
            💞 Ask out
          </Button>
        )}
        {bond.dating === "pending" && bond.dating_request_from !== bond.other_id && (
          <Button
            size="md"
            variant="accent"
            disabled={busy}
            onClick={() =>
              void run(
                () => socialApi.datingRespond(token, bond.other_username, true),
                `You're dating @${bond.other_username}. 💞`
              )
            }
          >
            Accept
          </Button>
        )}
      </div>
      <Dialog open={giftOpen} onClose={() => setGiftOpen(false)} title="Gift shelf">
        <div className="eko-bond__shelf">
          {shelf.map((g) => (
            <button
              key={g.id}
              type="button"
              className="eko-bond__gift"
              onClick={() => void sendGift(g)}
              aria-label={`Send ${g.name} for ₦${g.cost.toLocaleString("en-NG")}`}
            >
              <span className="eko-bond__gift-emoji" aria-hidden="true">
                {g.emoji}
              </span>
              <span className="eko-bond__gift-name">{g.name}</span>
              <span className="eko-bond__gift-cost">
                ₦{g.cost.toLocaleString("en-NG")}
              </span>
            </button>
          ))}
        </div>
        <p className="eko-chat__hint">
          Gifts spend game coins and grow closeness (+10 each).
        </p>
      </Dialog>
    </Card>
  );
}

export function BondsPanel({ token }: { token: string }) {
  const { toast } = useToast();
  const [bonds, setBonds] = useState<BondInfo[]>([]);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<BondInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const r = await socialApi.listBonds(token);
        setBonds(r.bonds);
        if (detail) {
          const fresh = r.bonds.find((b) => b.other_username === detail.other_username);
          if (fresh) setDetail(fresh);
        }
      } catch (err) {
        if (!silent) {
          toast(
            err instanceof ApiError ? err.message : "Couldn't load bonds.",
            "error"
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, toast, detail]
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const lookUp = async () => {
    const uname = query.trim().replace(/^@/, "");
    if (!uname) return;
    try {
      const r = await socialApi.bondWith(token, uname);
      setDetail(r.bond);
      setQuery("");
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Couldn't find that player.",
        "error"
      );
    }
  };

  return (
    <section aria-label="Closeness bonds" className="eko-fpage__section">
      <h3 className="eko-fpage__h">💞 Closeness</h3>
      <p className="eko-fpage__invite-text">
        Closeness grows when you actually vibe: DMs, hangouts, gifts. Hit{" "}
        <strong>50</strong> to add someone as family, <strong>150</strong> to
        start dating — they have to accept, of course.
      </p>
      <form
        className="eko-dms__new"
        onSubmit={(e) => {
          e.preventDefault();
          void lookUp();
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Check closeness with @username…"
          maxLength={16}
          aria-label="Check closeness by username"
        />
        <Button type="submit" size="md" variant="accent">
          View
        </Button>
      </form>

      {detail && (
        <BondDetail
          bond={detail}
          token={token}
          onChanged={() => {
            void load(true);
          }}
        />
      )}

      {loading ? (
        <p>Loading your bonds…</p>
      ) : bonds.length === 0 ? (
        <EmptyState
          emoji="💞"
          title="No bonds yet"
          body="Chat, hang out, and send gifts — closeness grows from real interaction."
        />
      ) : (
        bonds.map((b) => (
          <Card key={b.other_id} className="eko-fpage__row">
            <button
              type="button"
              className="eko-bond__rowbtn"
              onClick={() => setDetail(b)}
              aria-label={`View closeness with @${b.other_username}`}
            >
              <span className="eko-social__avatar" aria-hidden="true">
                {b.other_username.slice(0, 1).toUpperCase()}
              </span>
              <span className="eko-fpage__who">
                <strong>
                  @{b.other_username} <BondBadges bond={b} />
                </strong>
                <span className="eko-fpage__meta">
                  Closeness {b.score}
                  {b.family === "pending" && b.family_request_from === b.other_id
                    ? " · 👪 wants to be family"
                    : ""}
                  {b.dating === "pending" && b.dating_request_from === b.other_id
                    ? " · 💞 asked you out"
                    : ""}
                </span>
              </span>
            </button>
          </Card>
        ))
      )}
    </section>
  );
}

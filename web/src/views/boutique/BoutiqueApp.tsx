import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Loading } from "../../components";
import {
  ApiError,
  boutiqueApi,
  type BoutiqueItem,
} from "../../lib/api";
import { naira, type AvatarLook, type You } from "../../game/types";
import { buildAvatarLook } from "../avatar/avatarModel";
import {
  StudioPreview,
  type StudioPreviewApi,
} from "../avatar/editor/StudioPreview";
import { OUTFIT_ROWS, applyOutfitRow } from "../avatar/editor/catalog";
import {
  fetchAppearance,
  saveAppearance,
  AppearanceValidationError,
} from "../../avatar/persistence";
import "./BoutiqueApp.css";

/**
 * Phase 6 — Boutique: premium clothing shop (original build, behavior
 * modeled on the reference audit's Boutique screen).
 *
 * GAMEPLAY COINS ONLY. Twelve premium outfits across four occasions;
 * buying records the item in the server wardrobe, and wearing goes
 * through the existing revision-guarded appearance save (the server
 * rejects premium outfits the player doesn't own).
 *
 * Tabs: Shop (occasion filter chips + item grid + 3D try-on detail) and
 * My wardrobe (owned items, Wear buttons).
 */

type Occasion = "all" | "owambe" | "street" | "office" | "traditional";

const OCCASIONS: Array<{ id: Occasion; label: string }> = [
  { id: "all", label: "All" },
  { id: "owambe", label: "Owambe" },
  { id: "street", label: "Street" },
  { id: "office", label: "Office" },
  { id: "traditional", label: "Traditional" },
];

/** 3D try-on preview reusing the studio renderer. */
function TryOnPreview({ look }: { look: AvatarLook }) {
  const apiRef = useRef<StudioPreviewApi | null>(null);
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const built = buildAvatarLook(look);
      api.setFigure({ group: built.group, update: built.update });
    } catch {
      /* preview stays empty rather than breaking the view */
    }
    return () => {
      try {
        apiRef.current?.setFigure(null);
      } catch {
        /* noop */
      }
    };
  }, [look]);
  return (
    <div className="eko-boutique__preview">
      <StudioPreview
        onApi={(api) => {
          apiRef.current = api;
          if (api) {
            try {
              const built = buildAvatarLook(look);
              api.setFigure({ group: built.group, update: built.update });
            } catch {
              /* preview stays empty */
            }
          }
        }}
      />
    </div>
  );
}

export function BoutiqueApp({
  token,
  you,
}: {
  token: string;
  you: You;
}) {
  const [items, setItems] = useState<BoutiqueItem[] | null>(null);
  const [balance, setBalance] = useState(0);
  const [tab, setTab] = useState<"shop" | "wardrobe">("shop");
  const [occasion, setOccasion] = useState<Occasion>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wearing, setWearing] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await boutiqueApi.catalog(token);
      setItems(res.items);
      setBalance(res.balance);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load the boutique."
      );
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const ownedCount = useMemo(
    () => (items ?? []).filter((i) => i.owned).length,
    [items]
  );

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (i) => occasion === "all" || i.occasion === occasion
      ),
    [items, occasion]
  );

  const wardrobe = useMemo(() => (items ?? []).filter((i) => i.owned), [items]);

  const selected = useMemo(
    () => (items ?? []).find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  const baseLook: AvatarLook = useMemo(() => {
    const l = you.avatar_look;
    return {
      body: l?.body ?? "woman",
      skin: l?.skin ?? "cocoa",
      hair: l?.hair ?? "lowcut",
      outfit: l?.outfit ?? "casual",
      fabric: l?.fabric ?? "plain",
      topColor: l?.topColor ?? "#22d3ee",
      bottomColor: l?.bottomColor ?? "#334155",
    };
  }, [you.avatar_look]);

  const buy = async (item: BoutiqueItem) => {
    setBusy(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await boutiqueApi.buy(token, item.id);
      setItems((prev) =>
        prev
          ? prev.map((i) => (i.id === item.id ? { ...i, owned: true } : i))
          : prev
      );
      setBalance(res.balance);
      setNotice(`${item.name} is yours — check My wardrobe to wear it.`);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not buy that outfit."
      );
    } finally {
      setBusy(null);
    }
  };

  const wear = async (item: BoutiqueItem) => {
    const row = OUTFIT_ROWS.find((r) => r.outfitId === item.outfitId);
    if (!row) {
      setError("That outfit has no renderer mapping.");
      return;
    }
    if (you.character_id == null) {
      setError("Your character is still loading — try again in a moment.");
      return;
    }
    setWearing(item.id);
    setError(null);
    setNotice(null);
    try {
      const cid = String(you.character_id);
      const { appearance, revision } = await fetchAppearance(cid);
      // applyOutfitRow sets the row's ids + (for premium) signature colors,
      // so the worn look matches the try-on.
      const next = applyOutfitRow(appearance, row);
      await saveAppearance(cid, next, revision);
      setNotice(`${item.name} equipped. Looking sharp.`);
    } catch (e) {
      if (e instanceof AppearanceValidationError) {
        setError(e.errors[0] ?? "That outfit could not be equipped.");
      } else {
        setError(
          e instanceof Error ? e.message : "Could not wear that outfit."
        );
      }
    } finally {
      setWearing(null);
    }
  };

  if (items === null) {
    return (
      <div className="eko-boutique">
        {error ? (
          <EmptyState
            emoji="🛍️"
            title="Boutique unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : (
          <Loading message="Opening the boutique…" />
        )}
      </div>
    );
  }

  // ---- item detail / try-on ----
  if (selected) {
    // Try-on is free: the figure wears the outfit in its signature garment
    // colors — the look you'd actually buy.
    const row = OUTFIT_ROWS.find((r) => r.outfitId === selected.outfitId);
    const sig = row?.premium?.signature;
    const tryOn: AvatarLook = {
      ...baseLook,
      outfit: selected.outfitId,
      ...(sig ? { topColor: sig.topColor, bottomColor: sig.bottomColor } : null),
    };
    const affordable = balance >= selected.price;
    return (
      <div className="eko-boutique">
        <button
          type="button"
          className="eko-boutique__back"
          onClick={() => {
            setSelectedId(null);
            setError(null);
            setNotice(null);
          }}
        >
          ‹ Back
        </button>
        <TryOnPreview look={tryOn} />
        <div className="eko-boutique__detail">
          <h3 className="eko-boutique__name">{selected.name}</h3>
          <p className="eko-boutique__blurb">{selected.blurb}</p>
          <div className="eko-boutique__meta">
            <span className="eko-boutique__occasion">{selected.occasion}</span>
            <span className="eko-boutique__price">{naira(selected.price)}</span>
          </div>
          {error && <p className="eko-boutique__error">{error}</p>}
          {notice && <p className="eko-boutique__notice">{notice}</p>}
          {selected.owned ? (
            <Button
              onClick={() => void wear(selected)}
              disabled={wearing === selected.id}
            >
              {wearing === selected.id ? "Wearing…" : "Wear it"}
            </Button>
          ) : (
            <Button
              onClick={() => void buy(selected)}
              disabled={busy === selected.id || !affordable}
            >
              {busy === selected.id
                ? "Buying…"
                : affordable
                  ? `Buy · ${naira(selected.price)}`
                  : `Need ${naira(selected.price - balance)} more`}
            </Button>
          )}
          <p className="eko-boutique__hint">
            {selected.owned
              ? "Owned — wearing it updates your avatar everywhere."
              : "Try it on free. Buying is permanent and non-refundable."}
          </p>
        </div>
      </div>
    );
  }

  // ---- tabs ----
  return (
    <div className="eko-boutique">
      <div className="eko-boutique__head">
        <div>
          <h2 className="eko-boutique__title">Boutique</h2>
          <p className="eko-boutique__sub">Premium fits, owned forever.</p>
        </div>
        <div className="eko-boutique__balance">
          <span className="eko-boutique__balance-label">Balance</span>
          <span className="eko-boutique__balance-value">{naira(balance)}</span>
        </div>
      </div>

      <div className="eko-boutique__tabs" role="tablist" aria-label="Boutique sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "shop"}
          className={`eko-boutique__tab${tab === "shop" ? " eko-boutique__tab--active" : ""}`}
          onClick={() => setTab("shop")}
        >
          Shop
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "wardrobe"}
          className={`eko-boutique__tab${tab === "wardrobe" ? " eko-boutique__tab--active" : ""}`}
          onClick={() => setTab("wardrobe")}
        >
          My wardrobe ({ownedCount})
        </button>
      </div>

      {error && <p className="eko-boutique__error">{error}</p>}
      {notice && <p className="eko-boutique__notice">{notice}</p>}

      {tab === "shop" && (
        <>
          <div className="eko-boutique__chips" aria-label="Occasion filter">
            {OCCASIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`eko-boutique__chip${occasion === o.id ? " eko-boutique__chip--active" : ""}`}
                onClick={() => setOccasion(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              emoji="👔"
              title="Nothing here"
              body="No outfits for this occasion yet."
            />
          ) : (
            <div className="eko-boutique__grid">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="eko-boutique__card"
                  onClick={() => {
                    setSelectedId(item.id);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <span className="eko-boutique__card-occasion">
                    {item.occasion}
                  </span>
                  <span className="eko-boutique__card-name">{item.name}</span>
                  <span className="eko-boutique__card-price">
                    {item.owned ? "Owned ✓" : naira(item.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "wardrobe" && (
        <>
          {wardrobe.length === 0 ? (
            <EmptyState
              emoji="🚪"
              title="Wardrobe empty"
              body="Buy a fit from the shop and it lives here, ready to wear."
              action={<Button onClick={() => setTab("shop")}>Browse the shop</Button>}
            />
          ) : (
            <div className="eko-boutique__list">
              {wardrobe.map((item) => (
                <div key={item.id} className="eko-boutique__row">
                  <div>
                    <div className="eko-boutique__row-name">{item.name}</div>
                    <div className="eko-boutique__row-sub">{item.occasion}</div>
                  </div>
                  <Button
                    onClick={() => void wear(item)}
                    disabled={wearing === item.id}
                  >
                    {wearing === item.id ? "Wearing…" : "Wear"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

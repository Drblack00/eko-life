import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameSocket } from "../hooks/useGameSocket";
import {
  api,
  asList,
  authGet,
  normalizeConfig,
  travelFare,
  type FoodInfo,
  type FunInfo,
  type GameConfig,
} from "../lib/api";
import { CityMap } from "../game/CityMap";
import { mapXYToWorld, toPin } from "../game/mapPins";
import type { PinLocation } from "../game/stubLocations";
import {
  AVATAR_LOOK_FALLBACK_OPTIONS,
  naira,
  spawnEmoji,
  spawnLabel,
  spawnMapXY,
  type ActName,
  type LeaderEntry,
  type StreetSpawn,
  type You,
} from "../game/types";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  Sheet,
  Skeleton,
  StatBar,
} from "../components";
import { ChatTab } from "./chat/ChatTab";
import { FriendsPage } from "./Friends";
import { ElectionSheet } from "./election/ElectionSheet";
import { HomeTab, type HomeFocus } from "./home/HomeTab";
import { HomeView } from "./home/HomeView";
import { LedgerSheet } from "./home/LedgerSheet";
import { AvatarEditButton } from "./avatar/AvatarEditButton";
import { AdminView } from "./Admin";
import { TabBar, TABS, type Tab } from "./TabBar";
export { TABS };
export type { Tab };
import "./Admin.css";
import "./Game.css";
// V2 milestones: shifts (M7), needs (M8), daily (M9), economy (M10),
// governance (M11), skills/academy (M12).
import { Clock, JobsTab } from "./v2/m7";
import type { ShiftTrackInfo } from "./v2/m7";
import "./v2/m7/m7.css";
import { NeedsPanel } from "./v2/m8/NeedsPanel";
import "./v2/m8/NeedsPanel.css";
import { DailyTab } from "./v2/m9";
import "./v2/m9/DailyTab.css";
import { EconomyTab } from "./v2/m10";
import "./v2/m10/m10.css";
import { SkillsPanel, AcademyView } from "./v2/m12";
import "./v2/m12/m12.css";

/** HUD: money, day pill, governor pill, avatar — plus connection/offline state. */
function Hud({
  you,
  day,
  status,
  queued,
  lastError,
  governorName,
  onGovOpen,
  onRetry,
}: {
  you: You;
  day: number;
  status: string;
  queued: number;
  lastError: string | null;
  governorName: string | null;
  onGovOpen: () => void;
  onRetry: () => void;
}) {
  return (
    <header className="eko-hud">
      <div className="eko-hud__row">
        <span
          className="eko-hud__avatar"
          style={{ backgroundColor: you.color }}
          aria-hidden="true"
        >
          {you.avatar}
        </span>
        <div className="eko-hud__identity">
          <strong className="eko-hud__name">{you.name}</strong>
          <span className="eko-hud__money" aria-label={`Balance ${naira(you.money)}`}>
            {naira(you.money)}
          </span>
        </div>
        <button
          type="button"
          className="eko-hud__gov"
          onClick={onGovOpen}
          aria-haspopup="dialog"
          title="State House — elections"
        >
          {governorName ? `👑 @${governorName}` : "🏛️ No governor"}
        </button>
        <span className="eko-hud__day" aria-label={`Day ${day}`}>
          Day {day}
        </span>
        <Clock />
      </div>
      <div className="eko-hud__stats">
        <StatBar label="Energy" value={you.energy} icon="⚡" />
        <StatBar label="Health" value={you.health} icon="❤️" />
        <StatBar label="Happiness" value={you.happiness} icon="😊" />
        <StatBar label="Hunger" value={you.hunger} icon="🍽️" />
      </div>
      {status !== "open" && (
        <div
          className={`eko-offline ${status === "failed" ? "eko-offline--failed" : ""}`}
          role="status"
        >
          {status === "failed" ? (
            <>
              <span>{lastError ?? "Connection lost."}</span>
              <button type="button" className="eko-offline__retry" onClick={onRetry}>
                Retry
              </button>
            </>
          ) : (
            <span>
              {status === "connecting" ? "Connecting to the city…" : "Reconnecting…"}
              {queued > 0 &&
                ` — offline, ${queued} action${queued === 1 ? "" : "s"} queued and will retry.`}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

/** Contextual first-day guidance (audit improvement). */
function HintBar({ you, onGo }: { you: You; onGo: (t: Tab) => void }) {
  let hint: { text: string; tab: Tab } | null = null;
  if (you.hunger < 30)
    hint = { text: "You're hungry — grab food in Needs.", tab: "needs" };
  else if (you.energy < 30)
    hint = { text: "You're tired — rest or sleep it off.", tab: "me" };
  else if (you.money < 1000)
    hint = { text: "Wallet's light — clock in for a shift in Jobs.", tab: "jobs" };
  else if (you.happiness < 30)
    hint = { text: "Low spirits — have some fun.", tab: "needs" };
  if (!hint) return null;
  return (
    <button type="button" className="eko-hint" onClick={() => onGo(hint!.tab)}>
      <span aria-hidden="true">💡</span> {hint.text}
    </button>
  );
}

function CityTab({
  you,
  config,
  spawns,
  onPinSelect,
}: {
  you: You;
  config: GameConfig | null;
  spawns: StreetSpawn[];
  onPinSelect: (p: PinLocation) => void;
}) {
  const pins = useMemo<PinLocation[]>(() => {
    if (!config) return [];
    const list = asList(config.locations);
    const locPins = list.map((l, i) => toPin(l, i, list.length));
    // Street finds (server `spawn` broadcasts): 💵/🍲/🥤 pins.
    for (const s of spawns) {
      const xy = spawnMapXY(s);
      if (!xy) continue;
      const { x, z } = mapXYToWorld(xy.mx, xy.my);
      locPins.push({
        id: `spawn:${s.id}`,
        name: spawnLabel(s),
        emoji: spawnEmoji(s),
        blurb: "A street find — tap to grab it before it disappears.",
        x,
        z,
        zone: Math.abs(x) < 13 ? "lagoon" : x < 0 ? "mainland" : "island",
      });
    }
    const here = list.find((l) => l.id === you.locationId);
    if (here) {
      const base = toPin(here, 0, 1);
      locPins.push({
        ...base,
        id: `you:${you.id}`,
        name: `You — ${you.name}`,
        emoji: you.avatar,
        blurb: `This is you, at ${base.name}. Tap any other pin to travel there.`,
      });
    }
    return locPins;
  }, [config, you, spawns]);

  const hereName = useMemo(() => {
    const l = asList(config?.locations).find((x) => x.id === you.locationId);
    return l?.name ?? "Somewhere in Lagos";
  }, [config, you.locationId]);

  if (!config) {
    return (
      <div className="eko-tabpad" aria-label="Loading city">
        <Skeleton height={40} />
        <Skeleton height={380} rounded={16} />
      </div>
    );
  }

  return (
    <div className="eko-city">
      <div className="eko-city__bar">
        <span className="eko-city__here" aria-live="polite">
          📍 {hereName}
        </span>
        {spawns.length > 0 && (
          <span className="eko-city__spawns" aria-label={`${spawns.length} street finds nearby`}>
            💵 {spawns.length} find{spawns.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="eko-city__mapwrap">
        <CityMap pins={pins} onPinSelect={onPinSelect} />
      </div>
      <p className="eko-city__tip">
        Tap a pin to see what's there — travelling costs 5 energy, so choose
        well.
      </p>
    </div>
  );
}

/**
 * Available actions at a location, driven by its server `tags`
 * (market→jobs/eat, campus→study, bank→bank shortcut,
 * housing_office→rent change, beach/club→fun).
 */
function LocationActions({
  locationId,
  you,
  config,
  sendAct,
  onTab,
  onFocusHome,
}: {
  locationId: string;
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  onTab: (t: Tab) => void;
  onFocusHome: (s: Exclude<HomeFocus, null>) => void;
}) {
  const loc = asList(config.locations).find((l) => l.id === locationId);
  const tags = loc?.tags ?? [];
  const has = (...names: string[]) => names.some((n) => tags.includes(n));
  const here = you.locationId === locationId;
  const studyCost = config.studyCost ?? 5000;
  const canStudy = here && you.cert <= 0 && you.money >= studyCost;

  const funHere = useMemo(
    () => asList(config.fun).filter((f) => f.locationId === locationId),
    [config, locationId]
  );

  if (!loc) return null;

  return (
    <div className="eko-pin__actions">
      {has("market") && (
        <div className="eko-pin__btnrow">
          <Button size="md" variant="accent" onClick={() => onTab("jobs")}>
            💼 Find work
          </Button>
          <Button size="md" variant="accent" onClick={() => onTab("needs")}>
            🍲 Find food
          </Button>
        </div>
      )}
      {has("campus") && (
        <Button
          size="lg"
          variant="accent"
          disabled={!canStudy}
          className="eko-pin__full"
          onClick={() => sendAct("study")}
          aria-label={
            you.cert > 0
              ? "Certificate already earned"
              : !here
                ? "Travel here to study"
                : you.money < studyCost
                  ? `Study costs ${naira(studyCost)}`
                  : `Study for certificate, ${naira(studyCost)}`
          }
        >
          {you.cert > 0
            ? "🎓 Certificate earned"
            : !here
              ? "📚 Travel here to study"
              : you.money < studyCost
                ? `📚 Study · need ${naira(studyCost - you.money)} more`
                : `📚 Study for certificate · ${naira(studyCost)}`}
        </Button>
      )}
      {has("bank") && (
        <Button
          size="lg"
          variant="accent"
          className="eko-pin__full"
          onClick={() => onFocusHome("bank")}
        >
          🏦 Open bank
        </Button>
      )}
      {has("housing_office") && (
        <Button
          size="lg"
          variant="accent"
          className="eko-pin__full"
          onClick={() => onFocusHome("housing")}
        >
          🏠 Change rental
        </Button>
      )}
      {has("beach", "club") &&
        funHere.map((f) => {
          const afford = you.money >= f.cost;
          const disabled = !here || !afford;
          return (
            <Button
              key={f.id}
              size="lg"
              className="eko-pin__full"
              disabled={disabled}
              onClick={() => sendAct("fun", { what: f.id })}
            >
              {f.icon} {f.name}
              {!here
                ? " — travel here first"
                : !afford
                  ? ` — need ${naira(f.cost)}`
                  : ` — ${naira(f.cost)}`}
            </Button>
          );
        })}
    </div>
  );
}


function EatTab({
  you,
  config,
  onEat,
  onFun,
  onStudy,
}: {
  you: You;
  config: GameConfig | null;
  onEat: (item: FoodInfo) => void;
  onFun: (item: FunInfo) => void;
  onStudy: () => void;
}) {
  const campus = useMemo(
    () =>
      asList(config?.locations).find((l) => (l.tags ?? []).includes("campus")),
    [config]
  );
  const atCampus = !!campus && you.locationId === campus.id;
  const studyCost = config?.studyCost ?? 5000;
  const canStudy = atCampus && you.cert <= 0 && you.money >= studyCost;

  if (!config) {
    return (
      <div className="eko-tabpad" aria-label="Loading food">
        <Skeleton height={72} rounded={16} />
        <Skeleton height={72} rounded={16} />
        <Skeleton height={40} />
        <Skeleton height={72} rounded={16} />
      </div>
    );
  }
  const food = asList(config.food);
  const fun = asList(config.fun);
  const locName = (id: string) =>
    asList(config.locations).find((l) => l.id === id)?.name ?? "Lagos";

  return (
    <div className="eko-tabpad eko-eat">
      {campus && (
        <Card className="eko-eat__study">
          <div className="eko-food__head">
            <span className="eko-food__icon" aria-hidden="true">
              📚
            </span>
            <div className="eko-food__meta">
              <strong>Study at {campus.name}</strong>
              <span className="eko-food__fx">
                Earn a certificate — unlocks corporate jobs
              </span>
            </div>
          </div>
          <Button
            size="md"
            variant="accent"
            disabled={!canStudy}
            onClick={onStudy}
            aria-label={
              you.cert > 0
                ? "Certificate already earned"
                : !atCampus
                  ? `Study: travel to ${campus!.name} first`
                  : you.money < studyCost
                    ? `Study costs ${naira(studyCost)}`
                    : `Study for certificate, ${naira(studyCost)}`
            }
          >
            {you.cert > 0
              ? "🎓 Certificate earned"
              : !atCampus
                ? `Go to ${campus.name}`
                : you.money < studyCost
                  ? `Need ${naira(studyCost - you.money)} more`
                  : `Study now · ${naira(studyCost)}`}
          </Button>
        </Card>
      )}

      <h2 className="eko-tabh">Chop &amp; refuel</h2>
      {food.length === 0 ? (
        <EmptyState emoji="🍲" title="Kitchen's closed" body="No food on the menu right now." />
      ) : (
        food.map((f) => {
          const afford = you.money >= f.cost;
          return (
            <Card key={f.id} className="eko-food">
              <div className="eko-food__head">
                <span className="eko-food__icon" aria-hidden="true">
                  {f.icon}
                </span>
                <div className="eko-food__meta">
                  <strong>{f.name}</strong>
                  <span className="eko-food__fx">
                    +{f.hunger} hunger · +{f.energy} energy · +{f.happy} happy
                  </span>
                </div>
                <span className="eko-food__cost">{naira(f.cost)}</span>
              </div>
              <Button
                size="md"
                disabled={!afford}
                onClick={() => onEat(f)}
                aria-label={afford ? `Eat ${f.name}` : `Eat ${f.name}: need ${naira(f.cost)}`}
              >
                {afford ? "Eat" : `Need ${naira(f.cost)}`}
              </Button>
            </Card>
          );
        })
      )}

      <h2 className="eko-tabh">Have fun</h2>
      {fun.length === 0 ? (
        <EmptyState emoji="🎉" title="Nothing planned" body="The city hasn't scheduled any fun yet." />
      ) : (
        fun.map((f) => {
          const here = you.locationId === f.locationId;
          const afford = you.money >= f.cost;
          const disabled = !here || !afford;
          const reason = !here
            ? `📍 Go to ${locName(f.locationId)}`
            : !afford
              ? `Need ${naira(f.cost)}`
              : `Enjoy (+${f.happy} happy)`;
          return (
            <Card key={f.id} className="eko-food">
              <div className="eko-food__head">
                <span className="eko-food__icon" aria-hidden="true">
                  {f.icon}
                </span>
                <div className="eko-food__meta">
                  <strong>{f.name}</strong>
                  <span className="eko-food__fx">
                    +{f.happy} happiness
                    {f.energyDelta < 0 && ` · ${f.energyDelta} energy`}
                  </span>
                </div>
                <span className="eko-food__cost">{naira(f.cost)}</span>
              </div>
              <Button
                size="md"
                disabled={disabled}
                onClick={() => onFun(f)}
                aria-label={disabled ? `${f.name}: ${reason}` : `${f.name}: ${reason}`}
              >
                {reason}
              </Button>
            </Card>
          );
        })
      )}
    </div>
  );
}

/** City leaderboard — top 10 by money. Hides itself until GET /api/leaderboard lands. */
function LeaderboardCard({ token, you }: { token: string; you: You }) {
  const [leaders, setLeaders] = useState<LeaderEntry[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .leaderboard(token)
      .then((rows) => {
        if (live) setLeaders(rows);
      })
      .catch(() => {
        if (live) setLeaders(null);
      });
    return () => {
      live = false;
    };
  }, [token]);
  if (leaders === null || leaders === undefined) return null;
  if (leaders.length === 0) return null;
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <Card className="eko-me__card">
      <h2 className="eko-tabh" style={{ marginTop: 0 }}>
        🏆 City rankings
      </h2>
      <ol className="eko-leaders">
        {leaders.map((l, i) => {
          const isMe =
            (typeof l.id === "number" && l.id === you.id) ||
            l.username === you.username;
          return (
            <li
              key={`${l.username}-${i}`}
              className={`eko-leaders__row ${isMe ? "eko-leaders__row--me" : ""}`}
            >
              <span className="eko-leaders__rank" aria-hidden="true">
                {medals[i] ?? `${i + 1}.`}
              </span>
              <strong className="eko-leaders__name">
                @{l.username}
                {isMe && " (you)"}
              </strong>
              <span className="eko-leaders__money">{naira(l.money)}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function MeTab({
  you,
  config,
  token,
  onSleep,
  onRest,
  onSignOut,
  onUpgrade,
  onOpenAdmin,
  sendAct,
}: {
  you: You;
  config: GameConfig | null;
  token: string;
  onSleep: () => void;
  onRest: () => void;
  onSignOut: () => void;
  onUpgrade: () => void;
  onOpenAdmin: () => void;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const className =
    config?.classes?.[you.class]?.name ?? you.class ?? "Wanderer";
  const housingName =
    config?.housing?.[you.housing]?.name ?? you.housing ?? "—";
  return (
    <div className="eko-tabpad eko-me">
      <Card className="eko-me__card">
        <div className="eko-me__head">
          <span
            className="eko-me__avatar"
            style={{ backgroundColor: you.color }}
            aria-hidden="true"
          >
            {you.avatar}
          </span>
          <div>
            <strong className="eko-me__name">{you.name}</strong>
            <div className="eko-me__sub">
              {className} · {housingName}
              {you.cert > 0 && " · 🎓 Certified"}
            </div>
          </div>
        </div>
        <AvatarEditButton
          look={you.avatar_look}
          options={config?.avatarLook ?? AVATAR_LOOK_FALLBACK_OPTIONS}
          sendAct={sendAct}
        />
        <dl className="eko-me__rows">
          <div>
            <dt>Wallet</dt>
            <dd>{naira(you.money)}</dd>
          </div>
          <div>
            <dt>Savings</dt>
            <dd>{naira(you.savings)}</dd>
          </div>
          <div>
            <dt>Loan</dt>
            <dd>{naira(you.loan)}</dd>
          </div>
          <div>
            <dt>Home</dt>
            <dd>{housingName}</dd>
          </div>
        </dl>
        <Button
          size="md"
          variant="accent"
          onClick={() => setLedgerOpen(true)}
          className="eko-me__ledger"
        >
          💰 Money history
        </Button>
      </Card>

      <Card className="eko-me__card">
        <dl className="eko-me__rows">
          <div>
            <dt>Account type</dt>
            <dd>{you.guest ? "🧭 Guest" : "🧑 Full account"}</dd>
          </div>
          {you.is_admin && (
            <div>
              <dt>Role</dt>
              <dd>🛡️ Admin</dd>
            </div>
          )}
        </dl>
        {you.guest && (
          <>
            <p className="eko-me__tip">
              Guest progress lives on this device. Create a full account to
              keep your character, money, and home on any device.
            </p>
            <Button
              size="md"
              variant="accent"
              onClick={onUpgrade}
              className="eko-me__ledger"
            >
              🎒 Create full account — keep my progress
            </Button>
          </>
        )}
        {you.is_admin && (
          <Button
            size="md"
            variant="accent"
            onClick={onOpenAdmin}
            className="eko-me__ledger"
          >
            🛡️ Open admin dashboard
          </Button>
        )}
        <details className="eko-howto">
          <summary>Delete my data</summary>
          <p className="eko-me__tip">
            In-game account deletion isn't built yet — it's on the roadmap. To
            request deletion today, email the support team:{" "}
            <a href="mailto:support@eko-life.example">support@eko-life.example</a>{" "}
            <em>(placeholder address — the account API is still being built, so
            this link doesn't reach anyone real yet).</em>
          </p>
        </details>
      </Card>

      <div className="eko-me__actions">
        <Button size="lg" onClick={onSleep} className="eko-me__btn">
          😴 Sleep
        </Button>
        <Button size="lg" variant="accent" onClick={onRest} className="eko-me__btn">
          🛋️ Rest
        </Button>
      </div>
      <p className="eko-me__tip">
        Sleep restores the most energy — but the day keeps moving while you do.
      </p>

      <LeaderboardCard token={token} you={you} />

      <details className="eko-howto">
        <summary>How to play</summary>
        <ul>
          <li>
            <strong>Work</strong> at the right location to earn naira. Each
            shift costs energy and needs a breather before the next one.
          </li>
          <li>
            <strong>Eat</strong> to keep hunger up — an empty stomach drains
            your health.
          </li>
          <li>
            <strong>Travel</strong> around the city by tapping location pins.
          </li>
          <li>
            <strong>Rest or sleep</strong> when your energy runs low.
          </li>
          <li>One game day lasts 5 real minutes. Survive and thrive.</li>
        </ul>
      </details>

      <Button variant="ghost" onClick={onSignOut} className="eko-me__signout">
        Sign out
      </Button>

      <LedgerSheet token={token} open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  );
}

export function Game({
  token,
  onSignOut,
  onUpgrade,
}: {
  token: string;
  onSignOut: () => void;
  onUpgrade: () => void;
}) {
  const sock = useGameSocket(token);
  const [tab, setTab] = useState<Tab>("city");
  const [adminOpen, setAdminOpen] = useState(false);
  const [pinSheet, setPinSheet] = useState<PinLocation | null>(null);
  const [dayBanner, setDayBanner] = useState<number | null>(null);
  const [electionOpen, setElectionOpen] = useState(false);
  const [restConfig, setRestConfig] = useState<GameConfig | null>(null);
  const [slow, setSlow] = useState(false);
  const [homeFocus, setHomeFocus] = useState<HomeFocus>(null);
  // Workstream B: the HUD hint banner auto-dismisses while the Home Buy
  // sheet is open (half/full), so it can never cover the sheet's
  // interactive content. It returns as soon as the sheet closes.
  const [buySheetOpen, setBuySheetOpen] = useState(false);
  const prevDay = useRef<number | null>(null);

  // Gov results banner: auto-dismiss after 10s (the hook also toasts).
  useEffect(() => {
    if (!sock.govBanner) return;
    const t = window.setTimeout(() => sock.clearGovBanner(), 10_000);
    return () => window.clearTimeout(t);
  }, [sock.govBanner, sock]);

  // Slow-network notice while waiting for the first snapshot.
  useEffect(() => {
    if (sock.you) return;
    const t = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(t);
  }, [sock.you]);

  // Fallback: if `init` didn't carry config, fetch the public one.
  useEffect(() => {
    if (sock.config || restConfig) return;
    let live = true;
    api
      .config()
      .then((cfg) => {
        if (!live) return;
        const norm = normalizeConfig(cfg as unknown as Record<string, unknown>);
        if (norm) setRestConfig(norm);
      })
      .catch(() => {
        /* game still renders; tabs show empty states */
      });
    return () => {
      live = false;
    };
  }, [sock.config, restConfig]);

  const config = sock.config ?? restConfig;

  // Day-change banner.
  useEffect(() => {
    if (prevDay.current === null) {
      prevDay.current = sock.day;
      return;
    }
    if (sock.day !== prevDay.current) {
      prevDay.current = sock.day;
      setDayBanner(sock.day);
      const t = window.setTimeout(() => setDayBanner(null), 4500);
      return () => window.clearTimeout(t);
    }
  }, [sock.day]);

  const handlePinSelect = useCallback((p: PinLocation) => {
    setPinSheet(p);
  }, []);

  const travelTo = useCallback(
    (locationId: string) => {
      sock.sendAct("travel", { locationId });
      setPinSheet(null);
    },
    [sock]
  );

  const collectSpawn = useCallback(
    (spawnId: string | number) => {
      sock.sendCollect(spawnId);
      setPinSheet(null);
    },
    [sock]
  );

  const focusHome = useCallback((s: Exclude<HomeFocus, null>) => {
    setPinSheet(null);
    setHomeFocus(s);
    setTab("me"); // Home lives under the Me tab in v2
  }, []);

  if (!sock.you) {
    return (
      <div className="eko-game__boot">
        <Loading
          message={
            sock.status === "failed"
              ? (sock.lastError ?? "Connection failed.")
              : "Entering the city…"
          }
          slow={slow && !sock.you}
        />
        {sock.status === "failed" && (
          <div className="eko-game__boot-actions">
            <Button onClick={sock.retryNow}>Retry connection</Button>
            <Button variant="ghost" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        )}
      </div>
    );
  }

  const you = sock.you;
  const isSpawnPin = pinSheet?.id.startsWith("spawn:") ?? false;
  const spawn = isSpawnPin
    ? sock.spawns.find((s) => `spawn:${s.id}` === pinSheet!.id)
    : undefined;
  const pinIsHere =
    pinSheet != null &&
    (pinSheet.id === `you:${you.id}` || pinSheet.id === you.locationId);
  const pinLoc = config && pinSheet && !isSpawnPin
    ? asList(config.locations).find((l) => l.id === pinSheet.id)
    : undefined;
  // Display-only fare mirror; the server re-validates on travel.
  const fromLoc = config
    ? asList(config.locations).find((l) => l.id === you.locationId)
    : undefined;
  const fare = travelFare(fromLoc, pinLoc, config?.travelFares);
  const canTravel =
    !pinIsHere && you.energy >= 5 && you.money >= fare;

  return (
    <div className="eko-game">
      <Hud
        you={you}
        day={sock.day}
        status={sock.status}
        queued={sock.queued}
        lastError={sock.lastError}
        governorName={sock.governor?.name ?? null}
        onGovOpen={() => setElectionOpen(true)}
        onRetry={sock.retryNow}
      />

      {sock.govBanner?.name && (
        <div className="eko-govbanner" role="status">
          <span>👑 @{sock.govBanner.name} is the new governor of Èkó Life!</span>
          <button type="button" onClick={sock.clearGovBanner} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {dayBanner !== null && (
        <div className="eko-daybanner glass" role="status">
          ☀️ Day {dayBanner} — the city wakes up.
        </div>
      )}

      {!buySheetOpen && <HintBar you={you} onGo={setTab} />}

      <ElectionSheet
        open={electionOpen}
        onClose={() => setElectionOpen(false)}
        sock={sock}
        you={you}
      />

      {adminOpen && you.is_admin ? (
        <AdminView token={token} onBack={() => setAdminOpen(false)} />
      ) : (
        <>
          <main className="eko-main">
        {tab === "home" && config && (
          <HomeView
            you={you}
            config={config}
            sendAct={sock.sendAct}
            onBuySheetOpen={setBuySheetOpen}
          />
        )}
        {tab === "city" && (
          <CityTab
            you={you}
            config={config}
            spawns={sock.spawns}
            onPinSelect={handlePinSelect}
          />
        )}
        {tab === "jobs" && (
          <div className="eko-tabpad">
            <JobsTab
              you={you}
              send={(msg) => {
                const { a, ...rest } = msg as { t?: string; a: ActName } & Record<string, unknown>;
                sock.sendAct(a, rest);
              }}
              careerTracks={(config as unknown as { careerTracks?: ShiftTrackInfo[] } | null)?.careerTracks}
              skillLabels={(config as unknown as { skillLabels?: Record<string, string> } | null)?.skillLabels}
              locationName={(id: string) => asList(config?.locations).find((l) => l.id === id)?.name ?? id}
            />
            <SkillsPanel you={you} send={(a: string, params?: Record<string, unknown>) => sock.sendAct(a as ActName, params)} />
            <AcademyView you={you} send={(a: string, params?: Record<string, unknown>) => sock.sendAct(a as ActName, params)} />
          </div>
        )}
        {tab === "needs" && (
          <div className="eko-tabpad">
            <NeedsPanel you={you} sock={sock} />
            <EatTab
              you={you}
              config={config}
              onEat={(f) => sock.sendAct("eat", { item: f.id })}
              onFun={(f) => sock.sendAct("fun", { what: f.id })}
              onStudy={() => sock.sendAct("study")}
            />
          </div>
        )}
        {tab === "daily" && (
          <DailyTab
            you={you}
            send={(a: string, params?: Record<string, unknown>) => sock.sendAct(a as ActName, params)}
            api={{
              get: (path: string) => authGet(path, token),
            }}
          />
        )}
        {tab === "market" && <EconomyTab token={token} sock={sock} you={you} />}
        {tab === "chat" && <ChatTab sock={sock} you={you} />}
        {tab === "friends" && <FriendsPage token={token} />}
        {tab === "me" && (
          <>
            <MeTab
              you={you}
              config={config}
              token={token}
              onSleep={() => sock.sendAct("sleep")}
              onRest={() => sock.sendAct("rest")}
              onSignOut={onSignOut}
              onUpgrade={onUpgrade}
              onOpenAdmin={() => setAdminOpen(true)}
              sendAct={sock.sendAct}
            />
            {config && (
              <HomeTab
                you={you}
                config={config}
                sendAct={sock.sendAct}
                travelTo={travelTo}
                focus={homeFocus}
                onClearFocus={() => setHomeFocus(null)}
              />
            )}
          </>
        )}
      </main>

      <Sheet
        open={pinSheet !== null}
        onClose={() => setPinSheet(null)}
        label={pinSheet?.name ?? "Location"}
      >
        {pinSheet && (
          <div className="eko-pin">
            <div className="eko-pin__head">
              <span className="eko-pin__emoji" aria-hidden="true">
                {pinSheet.emoji}
              </span>
              <h2 className="eko-pin__name">{pinSheet.name}</h2>
            </div>
            <p className="eko-pin__blurb">{pinSheet.blurb}</p>

            {isSpawnPin && spawn && (
              <Button
                size="lg"
                onClick={() => collectSpawn(spawn.id)}
                className="eko-pin__go"
              >
                ✋ Collect
                {typeof spawn.amount === "number" && spawn.amount > 0
                  ? ` · ${naira(spawn.amount)}`
                  : ""}
              </Button>
            )}

            {!isSpawnPin && config && pinLoc && (
              <LocationActions
                locationId={pinLoc.id}
                you={you}
                config={config}
                sendAct={(a, p) => sock.sendAct(a, p)}
                onTab={setTab}
                onFocusHome={focusHome}
              />
            )}

            {!isSpawnPin && (
              <Button
                size="lg"
                disabled={!canTravel}
                onClick={() =>
                  travelTo(
                    pinSheet.id.startsWith("you:") ? you.locationId : pinSheet.id
                  )
                }
                className="eko-pin__go"
              >
                {pinIsHere
                  ? "You're already here"
                  : you.energy < 5
                    ? "Need 5 energy to travel"
                    : you.money < fare
                      ? `Need ${naira(fare)} fare`
                      : fare > 0
                        ? `Travel here · ${naira(fare)} fare`
                        : "Travel here"}
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <TabBar tab={tab} onTab={setTab} />
        </>
      )}
    </div>
  );
}

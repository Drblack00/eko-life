import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useGameSocket } from "../hooks/useGameSocket";
import {
  api,
  asList,
  authGet,
  normalizeConfig,
  travelFare,
  type ApiLocation,
  type GameConfig,
} from "../lib/api";
import { CityMap } from "../game/CityMap";
import { mapXYToWorld, toPin } from "../game/mapPins";
import type { PinLocation } from "../game/stubLocations";
import {
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
  Loading,
  Sheet,
  Skeleton,
  StatBar,
} from "../components";
import { EatTab } from "./EatTab";
import { ChatTab } from "./chat/ChatTab";
import { FriendsPage } from "./Friends";
import { GistApp } from "./gist/GistApp";
import { BankApp } from "./bank/BankApp";
import { BoutiqueApp } from "./boutique/BoutiqueApp";
import { StyleApp } from "./StyleApp";
import { ElectionSheet } from "./election/ElectionSheet";
import { HomeTab, type HomeFocus } from "./home/HomeTab";
import { HomeView } from "./home/HomeView";
import { LedgerSheet } from "./home/LedgerSheet";
import { AdminView } from "./Admin";
import { TabBar, TABS, type Tab } from "./TabBar";
export { TABS };
export type { Tab };
import { Phone } from "./phone/Phone";
import { BuyView } from "./buy/BuyView";
import { Walkthrough, WALKTHROUGH_KEY } from "./Walkthrough";
import { ThemePicker } from "../theme/theme";
import { CharacterPanel, type CharacterTabId } from "./CharacterPanel";
import "./CharacterPanel.css";
// M21: notifications (bell, panel, live toasts).
import {
  NotificationBell,
  NotificationPanel,
  NotificationToasts,
} from "./Notifications";
import "./Notifications.css";
import { NOTIFICATION_PREF_LABELS, type NotificationEntry, type NotificationPrefs } from "../game/types";
import "./Walkthrough.css";
import "./Admin.css";
import "./Game.css";
// Home screen chrome (Phase 1 of the reference audit): top status pill,
// floating cards, work/travel pills, announcement pill, shortcuts.
import {
  AnnouncementPill,
  HomeOverlays,
  ShortcutsDialog,
  TopUpDialog,
  useVisits,
} from "./home/HomeChrome";
import "./home/HomeChrome.css";
import { compactNum, moodFor } from "./home/homeChrome";
import { blip, isSoundEnabled, setSoundEnabled, SOUND_EVENT } from "../lib/sound";
// Phase 5: venue dialogs with activities ("things to do").
import { ThingsToDoDialog, VenueExtras } from "./VenuePanel";
import "./VenuePanel.css";
import { parseVenueHash } from "../game/venues";
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

/**
 * HUD: top status pill (avatar · live clock · mood · visits/online ·
 * sound toggle · wallet + top-up · notification bell · governor) plus
 * the needs bars and connection/offline state.
 */
function Hud({
  you,
  status,
  queued,
  lastError,
  governorName,
  online,
  unreadNotifications,
  onOpenCharacter,
  onOpenNeeds,
  onOpenNotifications,
  onGovOpen,
  onRetry,
  onTopUp,
}: {
  you: You;
  status: string;
  queued: number;
  lastError: string | null;
  governorName: string | null;
  online: number;
  unreadNotifications: number;
  onOpenCharacter: () => void;
  onOpenNeeds: () => void;
  onOpenNotifications: () => void;
  onGovOpen: () => void;
  onRetry: () => void;
  onTopUp: () => void;
}) {
  const visits = useVisits();
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  useEffect(() => {
    const onSound = (e: Event) =>
      setSoundOn((e as CustomEvent<boolean>).detail !== false);
    window.addEventListener(SOUND_EVENT, onSound);
    return () => window.removeEventListener(SOUND_EVENT, onSound);
  }, []);
  const mood = moodFor(you.happiness);
  const balance = you.is_admin ? "∞ Unlimited" : naira(you.money);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) blip("tap");
  };
  return (
    <header className="eko-hud">
      <div className="eko-top-pill glass" role="status" aria-label="Status">
        <button
          type="button"
          className="eko-top-pill__avatar"
          style={{ backgroundColor: you.color }}
          onClick={onOpenCharacter}
          title="My character"
          aria-label="Open my character panel"
        >
          {you.avatar}
        </button>
        <strong className="eko-top-pill__name">{you.name}</strong>
        <span className="eko-top-pill__sep" aria-hidden="true" />
        <Clock />
        <span
          className="eko-top-pill__mood"
          title={`Happiness ${Math.round(you.happiness)}`}
        >
          <span aria-hidden="true">{mood.emoji}</span>{" "}
          <span className="eko-top-pill__mood-text">{mood.label}</span>
        </span>
        <span
          className="eko-top-pill__online"
          title="City visits · players online"
        >
          {visits !== null ? `${compactNum(visits)} · ` : ""}
          {online} online
        </span>
        <span className="eko-top-pill__sep" aria-hidden="true" />
        <button
          type="button"
          className="eko-top-pill__iconbtn"
          onClick={toggleSound}
          aria-pressed={soundOn}
          title={soundOn ? "Mute sounds" : "Unmute sounds"}
          aria-label={soundOn ? "Mute sounds" : "Unmute sounds"}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
        <span
          className="eko-top-pill__wallet"
          aria-label={
            you.is_admin ? "Unlimited admin balance" : `Balance ${naira(you.money)}`
          }
        >
          {balance}
          <button
            type="button"
            className="eko-top-pill__topup"
            onClick={() => {
              blip("tap");
              onTopUp();
            }}
            aria-label="Top up wallet"
            title="Top up wallet"
          >
            +
          </button>
        </span>
        <NotificationBell unread={unreadNotifications} onOpen={onOpenNotifications} />
        <button
          type="button"
          className="eko-hud__gov"
          onClick={onGovOpen}
          aria-haspopup="dialog"
          title="State House — elections"
        >
          {governorName ? `👑 @${governorName}` : "🏛️ No governor"}
        </button>
      </div>
      <div
        className="eko-hud__stats eko-hud__stats--clickable"
        onClick={onOpenNeeds}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpenNeeds();
        }}
        aria-label="Open needs"
        title="Open needs"
      >
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

/** Contextual first-day guidance (audit improvement). Deep-links into phone apps. */
function HintBar({ you, onGo }: { you: You; onGo: (app: string) => void }) {
  let hint: { text: string; app: string } | null = null;
  if (you.hunger < 30)
    hint = { text: "You're hungry — grab food in Needs.", app: "needs" };
  else if (you.energy < 30)
    hint = { text: "You're tired — rest or sleep it off.", app: "me" };
  else if (you.money < 1000)
    hint = { text: "Wallet's light — clock in for a shift in Jobs.", app: "jobs" };
  else if (you.happiness < 30)
    hint = { text: "Low spirits — have some fun.", app: "needs" };
  if (!hint) return null;
  return (
    <button type="button" className="eko-hint" onClick={() => onGo(hint!.app)}>
      <span aria-hidden="true">💡</span> {hint.text}
    </button>
  );
}

function CityTab({
  you,
  config,
  spawns,
  onPinSelect,
  onOpenThings,
}: {
  you: You;
  config: GameConfig | null;
  spawns: StreetSpawn[];
  onPinSelect: (p: PinLocation) => void;
  onOpenThings: () => void;
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
        <button
          type="button"
          className="eko-city__things"
          onClick={onOpenThings}
          aria-label="Things to do — open the venue list"
        >
          🎯 Things to do
        </button>
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
  onOpenApp,
  onFocusHome,
}: {
  locationId: string;
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  onOpenApp: (app: string) => void;
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
          <Button size="md" variant="accent" onClick={() => onOpenApp("jobs")}>
            💼 Find work
          </Button>
          <Button size="md" variant="accent" onClick={() => onOpenApp("needs")}>
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
  onReplayWalkthrough,
  notifPrefs,
  onNotifPrefs,
}: {
  you: You;
  config: GameConfig | null;
  token: string;
  onSleep: () => void;
  onRest: () => void;
  onSignOut: () => void;
  onUpgrade: () => void;
  onOpenAdmin: () => void;
  onReplayWalkthrough: () => void;
  notifPrefs: NotificationPrefs | null;
  onNotifPrefs: (p: Partial<NotificationPrefs>) => void;
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
        <dl className="eko-me__rows">
          <div>
            <dt>Wallet</dt>
            {/* M21: admins see unlimited (private view); the coins column
                itself stays small so the leaderboard shows the decoy. */}
            <dd>{you.is_admin ? "∞ Unlimited" : naira(you.money)}</dd>
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

      <Card className="eko-me__card">
        <h2 className="eko-tabh" style={{ marginTop: 0 }}>
          ⚙️ Settings
        </h2>
        <Button
          size="md"
          variant="ghost"
          onClick={onReplayWalkthrough}
          className="eko-me__ledger"
        >
          🎬 Replay walkthrough
        </Button>
        <ThemePicker />
        {/* M21: notification preferences */}
        <div className="eko-me__notifprefs">
          <h3 className="eko-me__notifprefs-title">🔔 Notifications</h3>
          {(Object.keys(NOTIFICATION_PREF_LABELS) as Array<keyof NotificationPrefs>).map(
            (key) => {
              const label = NOTIFICATION_PREF_LABELS[key];
              const on = notifPrefs ? notifPrefs[key] !== false : true;
              return (
                <label key={key} className="eko-me__notifpref">
                  <span className="eko-me__notifpref-text">
                    <strong>{label.title}</strong>
                    <small>{label.hint}</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={label.title}
                    className={`eko-switch${on ? " eko-switch--on" : ""}`}
                    onClick={() => onNotifPrefs({ [key]: !on })}
                  >
                    <span className="eko-switch__knob" aria-hidden="true" />
                  </button>
                </label>
              );
            }
          )}
        </div>
      </Card>

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
  const [tab, setTab] = useState<Tab>("home");
  const [adminOpen, setAdminOpen] = useState(false);
  // Phone slide-over: opens WITHOUT changing the dock tab.
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneApp, setPhoneApp] = useState<string | null>(null);
  const openPhoneApp = useCallback((app: string) => {
    setPhoneApp(app);
    setPhoneOpen(true);
  }, []);
  // Character panel (Phase 2 of the reference audit): tabbed dialog opened
  // from the avatar button in the top status pill.
  const [charPanel, setCharPanel] = useState<{
    open: boolean;
    tab: CharacterTabId;
  }>({ open: false, tab: "profile" });
  const openCharacterPanel = useCallback((tab: CharacterTabId) => {
    setCharPanel({ open: true, tab });
  }, []);
  // First-launch walkthrough (skippable, replayable from Me → Settings).
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const replayWalkthrough = useCallback(() => {
    try {
      localStorage.removeItem(WALKTHROUGH_KEY);
    } catch {
      /* private mode — the overlay just opens */
    }
    setWalkthroughOpen(true);
  }, []);
  const [pinSheet, setPinSheet] = useState<PinLocation | null>(null);
  // Phase 5: "Things to do" (T) dialog.
  const [thingsOpen, setThingsOpen] = useState(false);
  const [dayBanner, setDayBanner] = useState<number | null>(null);
  const [electionOpen, setElectionOpen] = useState(false);
  // M21: notification panel visibility.
  const [notifOpen, setNotifOpen] = useState(false);
  // Home screen chrome (Phase 1): clean-screen mode, shortcuts dialog,
  // top-up dialog, and the session-dismissed announcement pill.
  const [cleanMode, setCleanMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [announceDismissed, setAnnounceDismissed] = useState(false);
  /** Tap a notification (panel row or live toast) → jump to the right screen. */
  const onNotificationTap = useCallback(
    (n: NotificationEntry) => {
      setNotifOpen(false);
      sock.markNotificationRead(n.id);
      const data = n.data ?? {};
      if (n.type === "friend_online") {
        openPhoneApp("friends");
      } else if (n.type === "money_received") {
        openPhoneApp("me");
      } else if (n.type === "room_message") {
        const rid = Number(
          (data as Record<string, unknown>).roomId ??
            (data as Record<string, unknown>).room_id
        );
        if (Number.isFinite(rid) && rid > 0) sock.requestRoomNav(rid);
        openPhoneApp("chat");
      }
    },
    [sock, openPhoneApp]
  );
  // Keyboard shortcuts (Phase 1 of the reference audit) — adapted to our
  // tabs (Home / Buy / Map / Phone). Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const closeTop = () => {
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return true;
        }
        if (phoneOpen) {
          setPhoneOpen(false);
          setPhoneApp(null);
          return true;
        }
        if (notifOpen) {
          setNotifOpen(false);
          return true;
        }
        return false;
      };
      if (k === "escape") {
        if (closeTop()) e.preventDefault();
        return;
      }
      if (k === "?") {
        setShortcutsOpen(true);
        return;
      }
      if (k === "h") setTab("home");
      else if (k === "b") setTab("buy");
      else if (k === "m") setTab("map");
      else if (k === "p") {
        if (phoneOpen) {
          setPhoneOpen(false);
          setPhoneApp(null);
        } else setPhoneOpen(true);
      } else if (k === "n") {
        setNotifOpen(true);
        sock.openNotifications();
      } else if (k === "d") openPhoneApp("daily");
      else if (k === "j") openPhoneApp("jobs");
      else if (k === "t") setThingsOpen(true);
      else return;
      blip("tap");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsOpen, phoneOpen, notifOpen, openPhoneApp, sock]);

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

  // Phase 5: tapping a venue in "Things to do" opens its pin sheet dialog.
  const openVenueFromList = useCallback(
    (loc: ApiLocation) => {
      setThingsOpen(false);
      const list = asList(config?.locations);
      const i = list.findIndex((l) => l.id === loc.id);
      if (i >= 0) handlePinSelect(toPin(list[i], i, list.length));
    },
    [config, handlePinSelect]
  );

  // Phase 5: #venue=<locationId> deep links (from venue share rows).
  useEffect(() => {
    if (!config) return;
    const applyHash = () => {
      const id = parseVenueHash(window.location.hash);
      if (!id) return;
      const list = asList(config.locations);
      const i = list.findIndex((l) => l.id === id);
      if (i >= 0) handlePinSelect(toPin(list[i], i, list.length));
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [config, handlePinSelect]);

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
    setTab("home"); // Home lives on the Home dock tab
  }, []);

  // First-launch walkthrough: show once, right after login, unless the
  // seen-flag is set (the overlay sets it on skip/finish).
  useEffect(() => {
    if (!sock.you) return;
    let seen = false;
    try {
      seen = localStorage.getItem(WALKTHROUGH_KEY) === "1";
    } catch {
      /* private mode — show it */
    }
    if (!seen) setWalkthroughOpen(true);
  }, [sock.you]);

  /**
   * Phone app content. The old dock tabs (jobs/needs/daily/market/chat/
   * friends/me) live here now — the JSX is copied verbatim from the old
   * tab branches with the same props.
   * NOTE: this hook sits ABOVE the `if (!sock.you)` early return (hooks
   * must run unconditionally) — `you` is read inside and null-guarded.
   */
  const renderPhoneApp = useCallback(
    (appId: string): ReactNode => {
      const you = sock.you;
      if (!you) return null;
      const send = (a: string, params?: Record<string, unknown>) =>
        sock.sendAct(a as ActName, params);
      switch (appId) {
        case "jobs":
          return (
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
              <SkillsPanel you={you} send={send} />
              <AcademyView you={you} send={send} />
            </div>
          );
        case "needs":
          return (
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
          );
        case "daily":
          return (
            <DailyTab
              you={you}
              send={send}
              api={{
                get: (path: string) => authGet(path, token),
              }}
            />
          );
        case "market":
          return <EconomyTab token={token} sock={sock} you={you} />;
        case "chat":
          return <ChatTab sock={sock} you={you} />;
        case "friends":
          return <FriendsPage token={token} />;
        case "gist":
          return (
            <div className="eko-tabpad">
              <GistApp token={token} you={you} config={config} />
            </div>
          );
        case "bank":
          // Phase 4: Èkó Reserve — the bank phone app (gameplay coins only).
          // Top-up reuses the existing inert dialog (coming-soon, Jobs route).
          return (
            <div className="eko-tabpad">
              <BankApp
                token={token}
                you={you}
                sendAct={send}
                onTopUp={() => setTopUpOpen(true)}
              />
            </div>
          );
        case "boutique":
          // Phase 6: Boutique — premium clothing shop (gameplay coins only).
          return (
            <div className="eko-tabpad">
              <BoutiqueApp token={token} you={you} />
            </div>
          );
        case "style":
          return you.character_id != null ? (
            <StyleApp characterId={String(you.character_id)} />
          ) : (
            <p className="eko-me__tip">
              Your character is still loading — reopen Style in a moment.
            </p>
          );
        case "me":
        default:
          return (
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
                onReplayWalkthrough={replayWalkthrough}
                notifPrefs={sock.notifPrefs}
                onNotifPrefs={sock.updateNotifPrefs}
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
                  onOpenBank={() => setPhoneApp("bank")}
                />
              )}
            </>
          );
      }
    },
    [config, token, sock, travelTo, homeFocus, onSignOut, onUpgrade, replayWalkthrough]
  );

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

  const isSpawnPin = pinSheet?.id.startsWith("spawn:") ?? false;  const spawn = isSpawnPin
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
    <div className={cleanMode ? "eko-game eko-game--clean" : "eko-game"}>
      <Hud
        you={you}
        status={sock.status}
        queued={sock.queued}
        lastError={sock.lastError}
        governorName={sock.governor?.name ?? null}
        online={sock.online}
        unreadNotifications={sock.unreadNotifications}
        onOpenCharacter={() => openCharacterPanel("profile")}
        onOpenNeeds={() => openCharacterPanel("needs")}
        onOpenNotifications={() => {
          setNotifOpen(true);
          sock.openNotifications(); // loads the list + clears the badge
        }}
        onGovOpen={() => setElectionOpen(true)}
        onRetry={sock.retryNow}
        onTopUp={() => setTopUpOpen(true)}
      />

      {!announceDismissed && (
        <AnnouncementPill onDismiss={() => setAnnounceDismissed(true)} />
      )}

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

      {!buySheetOpen && <HintBar you={you} onGo={openPhoneApp} />}

      {/* Phase 1 home chrome: floating cards + work/travel pills (home tab only). */}
      {tab === "home" && (
        <HomeOverlays
          token={token}
          shift={you.shift ?? null}
          fares={config?.travelFares}
          cleanMode={cleanMode}
          onToggleClean={() => setCleanMode((c) => !c)}
          onOpenApp={openPhoneApp}
          onTab={(t) => (t === "phone" ? setPhoneOpen(true) : setTab(t))}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenCharacter={openCharacterPanel}
        />
      )}

      {cleanMode && (
        <button
          type="button"
          className="eko-cleanrestore glass"
          onClick={() => {
            blip("tap");
            setCleanMode(false);
          }}
        >
          📺 Show UI
        </button>
      )}

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <TopUpDialog
        open={topUpOpen}
        balance={you.is_admin ? "∞ Unlimited" : naira(you.money)}
        onClose={() => setTopUpOpen(false)}
        onEarn={() => openPhoneApp("jobs")}
      />

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
            token={token}
            sock={sock}
            sendAct={sock.sendAct}
            onBuySheetOpen={setBuySheetOpen}
          />
        )}
        {tab === "buy" && config && (
          <BuyView
            you={you}
            config={config}
            sendAct={sock.sendAct}
            onBuySheetOpen={setBuySheetOpen}
          />
        )}
        {tab === "map" && (
          <CityTab
            you={you}
            config={config}
            spawns={sock.spawns}
            onPinSelect={handlePinSelect}
            onOpenThings={() => setThingsOpen(true)}
          />
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

            {!isSpawnPin && config && pinLoc && (
              <VenueExtras
                locationId={pinLoc.id}
                you={you}
                config={config}
                sendAct={(a, p) => sock.sendAct(a, p)}
              />
            )}

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
                onOpenApp={openPhoneApp}
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

      {/* Phase 5: "Things to do" (T) — every venue, one teaser each. */}
      <ThingsToDoDialog
        open={thingsOpen}
        onClose={() => setThingsOpen(false)}
        config={config}
        onSelect={openVenueFromList}
      />

      <Walkthrough
        open={walkthroughOpen}
        onDone={() => setWalkthroughOpen(false)}
      />

      {/* M21: notifications — panel (badge clears on open) + live toasts. */}
      <NotificationPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={sock.notifications}
        onTap={onNotificationTap}
        onMarkAllRead={() => sock.openNotifications()}
      />
      <NotificationToasts
        toasts={sock.notifToasts}
        onTap={onNotificationTap}
        onDismiss={sock.dismissNotifToast}
      />

      {/* Phase 2: tabbed character panel (avatar button in the top pill). */}
      {you && (
        <CharacterPanel
          open={charPanel.open}
          initialTab={charPanel.tab}
          token={token}
          you={you}
          onClose={() => setCharPanel((p) => ({ ...p, open: false }))}
          onOpenApp={openPhoneApp}
          onReplayWalkthrough={replayWalkthrough}
          onSignOut={onSignOut}
          notifPrefs={sock.notifPrefs}
          onNotifPrefs={sock.updateNotifPrefs}
          onProfileChanged={(patch) => sock.patchYou(patch)}
        />
      )}

      <Phone
        open={phoneOpen}
        onClose={() => {
          setPhoneOpen(false);
          setPhoneApp(null);
        }}
        activeApp={phoneApp}
        onSelectApp={setPhoneApp}
        renderApp={renderPhoneApp}
      />

      <TabBar
        tab={tab}
        onTab={(t) => (t === "phone" ? setPhoneOpen(true) : setTab(t))}
      />
        </>
      )}
    </div>
  );
}

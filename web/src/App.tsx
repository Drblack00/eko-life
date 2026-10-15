import { Suspense, lazy, useEffect, useState } from "react";
import { Button, Loading, ToastProvider } from "./components";
import { Landing, type AuthEntry } from "./views/Landing";
// Perf: Auth + CreateCharacter only render after a user action — keep them
// out of the initial bundle. Landing + Game stay eager (critical path).
const Auth = lazy(() =>
  import("./views/Auth").then((m) => ({ default: m.Auth }))
);
const CreateCharacter = lazy(() =>
  import("./views/CreateCharacter").then((m) => ({ default: m.CreateCharacter }))
);
import { Game } from "./views/Game";
import { api, ApiError, type Me } from "./lib/api";
import { clearSession, getToken, getUsername } from "./lib/auth";
import {
  startCloudSaveSync,
  stopCloudSaveSync,
  type CloudSavePayload,
} from "./lib/cloudSave";
import { WALKTHROUGH_KEY } from "./views/Walkthrough";

type View = "landing" | "auth" | "gate" | "create" | "game";

const VIEW_KEY = "eko_view";

/** localStorage key mirrored by the cloud save (see lib/cloudSave.ts). */
const BLOCK_KEY = "eko:blocked:v1";

/** Read the ancillary local state that the cloud save mirrors. */
function readCloudPayload(username: string): CloudSavePayload {
  let blocked: Record<string, string> | undefined;
  try {
    const raw = window.localStorage.getItem(BLOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") blocked = parsed;
    }
  } catch {
    /* ignore — payload just omits it */
  }
  let walkthroughDone = false;
  try {
    walkthroughDone = window.localStorage.getItem(WALKTHROUGH_KEY) === "1";
  } catch {
    /* ignore */
  }
  let charDone = false;
  try {
    charDone = window.localStorage.getItem(`eko_char_done:${username}`) === "1";
  } catch {
    /* ignore */
  }
  return { v: 1, blocked, walkthroughDone, charDone };
}

/**
 * Apply a server cloud-save payload over local state, then notify the
 * game socket hook so in-memory state (blocked map) refreshes too.
 */
function applyCloudPayload(username: string, p: CloudSavePayload): void {
  try {
    if (p.blocked !== undefined)
      window.localStorage.setItem(BLOCK_KEY, JSON.stringify(p.blocked));
    if (p.walkthroughDone !== undefined)
      window.localStorage.setItem(WALKTHROUGH_KEY, p.walkthroughDone ? "1" : "0");
    if (p.charDone !== undefined) {
      const k = `eko_char_done:${username}`;
      if (p.charDone) window.localStorage.setItem(k, "1");
      else window.localStorage.removeItem(k);
    }
  } catch {
    /* private mode — nothing persisted */
  }
  window.dispatchEvent(new Event("eko:cloud-save-applied"));
}

/**
 * Tiny view router — no react-router needed for v1.
 * landing → auth → (me gate) → create-character (if needed) → game.
 * The chosen view persists in localStorage.
 */
export function App() {
  const [view, setView] = useState<View>(() => (getToken() ? "gate" : "landing"));
  const [authTab, setAuthTab] = useState<AuthEntry>("signup");
  const [username, setUsername] = useState<string>(() => getUsername() ?? "");
  const [token, setToken] = useState<string | null>(() => getToken());
  const [gateError, setGateError] = useState("");
  /** Guest session token to migrate when a guest upgrades to a full account. */
  const [upgradeToken, setUpgradeToken] = useState<string | null>(null);
  /** W3: referral code from a ?ref= invite link — read once at boot. */
  const [referralCode] = useState<string | null>(() => {
    try {
      const c = new URLSearchParams(window.location.search).get("ref")?.trim();
      return c || null;
    } catch {
      return null;
    }
  });

  const go = (v: View) => {
    setView(v);
    try {
      if (v !== "gate") localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private-mode browsers: view just won't persist */
    }
  };

  const signOut = () => {
    stopCloudSaveSync();
    clearSession();
    setToken(null);
    setUsername("");
    setGateError("");
    setUpgradeToken(null);
    go("landing");
  };

  /**
   * M4: guest upgrades from the Me tab. Their guest token rides along so the
   * server migrates the guest row in place (progress kept).
   */
  const upgradeToAccount = () => {
    const t = getToken();
    if (!t) return;
    setUpgradeToken(t);
    setAuthTab("signup");
    go("auth");
  };

  // Post-auth gate: fetch /api/me to decide create-character vs game.
  useEffect(() => {
    if (view !== "gate") return;
    const t = getToken();
    if (!t) {
      go("landing");
      return;
    }
    setToken(t);
    setGateError("");
    let live = true;
    api
      .me(t)
      .then((me) => {
        if (!live) return;
        setUsername(me.username);
        // Cloud saves: sync ancillary local state for full accounts.
        // Guests stay local-only (server 403s their cloud-save calls).
        if (me.is_guest) {
          stopCloudSaveSync();
        } else {
          const uname = me.username;
          startCloudSaveSync(
            () => readCloudPayload(uname),
            (p) => applyCloudPayload(uname, p)
          );
        }
        go(needsCreation(me) ? "create" : "game");
      })
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          setToken(null);
          go("landing");
          return;
        }
        setGateError(
          err instanceof ApiError
            ? err.message
            : "Couldn't reach the city. Check your connection."
        );
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <ToastProvider>
      {view === "landing" && (
        <Landing
          onAuth={(tab) => {
            setAuthTab(tab);
            go("auth");
          }}
        />
      )}
      {view === "auth" && (
        <Suspense fallback={<Loading message="Loading…" />}>
          <Auth
          initialTab={authTab}
          guestToken={upgradeToken}
          referralCode={referralCode}
          onBack={() => {
            setUpgradeToken(null);
            go(upgradeToken ? "game" : "landing");
          }}
          onDone={(name) => {
            setUsername(name);
            setToken(getToken());
            setUpgradeToken(null);
            go("gate");
          }}
          />
        </Suspense>
      )}
      {view === "gate" && (
        <div className="eko-game__boot">
          {gateError ? (
            <>
              <p role="alert" style={{ color: "var(--danger)", fontWeight: 600 }}>
                {gateError}
              </p>
              <Button onClick={() => go("gate")}>Retry</Button>
              <Button variant="ghost" onClick={signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Loading message="Checking your character…" />
          )}
        </div>
      )}
      {view === "create" && token && (
        <Suspense fallback={<Loading message="Loading…" />}>
          <CreateCharacter
            token={token}
            username={username}
            onDone={() => go("game")}
            onSignOut={signOut}
          />
        </Suspense>
      )}
      {view === "game" && token && (
        <Game token={token} onSignOut={signOut} onUpgrade={upgradeToAccount} />
      )}
    </ToastProvider>
  );
}

/**
 * True when the account's character still needs M2 creation.
 * - `customized === false` / missing class: explicit server signal.
 * - Untouched M1 defaults (name = username, street_smart, default avatar/color):
 *   creation was never done — unless this device already completed it.
 */
function needsCreation(me: Me): boolean {
  if (me.customized === false) return true;
  if (!me.class) return true;
  if (
    me.name === me.username &&
    me.class === "street_smart" &&
    me.avatar === "🧑" &&
    me.color === "#22d3ee"
  ) {
    try {
      return localStorage.getItem(`eko_char_done:${me.username}`) !== "1";
    } catch {
      return true;
    }
  }
  return false;
}

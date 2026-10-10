import { useEffect, useState } from "react";
import { Button, Loading, ToastProvider } from "./components";
import { Landing, type AuthEntry } from "./views/Landing";
import { Auth } from "./views/Auth";
import { CreateCharacter } from "./views/CreateCharacter";
import { Game } from "./views/Game";
import { api, ApiError, type Me } from "./lib/api";
import { clearSession, getToken, getUsername } from "./lib/auth";
import "./views/Auth.css"; // shared .eko-input / .eko-check / .eko-field styles

type View = "landing" | "auth" | "gate" | "create" | "game";

const VIEW_KEY = "eko_view";

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
        <CreateCharacter
          token={token}
          username={username}
          onDone={() => go("game")}
          onSignOut={signOut}
        />
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

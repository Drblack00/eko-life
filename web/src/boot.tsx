import { useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { beaconError } from "./lib/beacon";
import "./styles/tokens.css";
import "./styles/base.css";
import "./boot.css";

const STAGES = [
  "Waking up the lagoon…",
  "Polishing the danfos…",
  "Counting the skyline…",
  "Opening the city gates…",
];

/** Clear service worker + caches + localStorage, then reload. */
async function startFresh() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* best effort */
  }
  window.location.reload();
}

function BootScreen() {
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [LoadedApp, setLoadedApp] = useState<ComponentType | null>(null);

  useEffect(() => {
    let mounted = true;
    const stageTimer = window.setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, 900);
    const slowTimer = window.setTimeout(() => {
      if (mounted) setSlow(true);
    }, 15_000);

    // Lazy-load the App chunk while the staged loader plays, then swap in.
    const warm = async () => {
      try {
        const mod = await import("./App");
        if (mounted) setLoadedApp(() => mod.App);
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : "Boot failed";
        setFailed(msg);
        beaconError(msg, "boot", err instanceof Error ? err.stack : undefined);
      }
    };
    warm();

    return () => {
      mounted = false;
      window.clearInterval(stageTimer);
      window.clearTimeout(slowTimer);
    };
  }, []);

  if (LoadedApp) return <LoadedApp />;

  return (
    <div className="eko-boot" role="status" aria-live="polite">
      <div className="eko-boot__logo" aria-hidden="true">
        🌊
      </div>
      <h1 className="eko-boot__title">Èkó Life</h1>
      {failed ? (
        <>
          <p className="eko-boot__message eko-boot__message--error">
            The city couldn't load ({failed}). Your connection may be down.
          </p>
          <button type="button" className="eko-boot__fresh" onClick={startFresh}>
            Start fresh
          </button>
        </>
      ) : (
        <>
          <div className="eko-boot__spinner" aria-hidden="true" />
          <p className="eko-boot__message">{STAGES[stage]}</p>
          {slow && (
            <p className="eko-boot__slow">
              Slow network… still loading. If this hangs, you can{" "}
              <button
                type="button"
                className="eko-boot__fresh-link"
                onClick={startFresh}
              >
                start fresh
              </button>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

function installGlobalHandlers() {
  window.addEventListener("error", (e) => {
    beaconError(e.message || "window.onerror", "global", e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    beaconError(
      reason instanceof Error ? reason.message : String(reason),
      "unhandledrejection",
      reason instanceof Error ? reason.stack : undefined
    );
  });
}

export function boot() {
  installGlobalHandlers();
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  createRoot(rootEl).render(<BootScreen />);

  // Register the hand-rolled service worker in production only.
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW is a progressive enhancement */
      });
    });
  }
}

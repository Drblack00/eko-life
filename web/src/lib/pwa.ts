/**
 * Headless PWA install-prompt API.
 *
 * No visible UI here by design — the module only captures and exposes the
 * browser's native `beforeinstallprompt` flow. All functions are safe
 * no-ops when window/the event is unavailable (SSR / test environments).
 */

/** Outcome of a `promptInstall()` attempt. */
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/**
 * Structural shape of the browser's `BeforeInstallPromptEvent`.
 * (Not in lib.dom, so it is declared structurally instead of via a global.)
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Listener called whenever the installable state flips. */
export type InstallableChangeCallback = (installable: boolean) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const changeListeners = new Set<InstallableChangeCallback>();
let listenersAttached = false;

function notifyInstallableChange(installable: boolean): void {
  for (const cb of changeListeners) {
    try {
      cb(installable);
    } catch {
      /* a bad listener must not break install flow */
    }
  }
}

function attachWindowListeners(): void {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyInstallableChange(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyInstallableChange(false);
  });
}

/**
 * Whether the app is currently installable (a `beforeinstallprompt` event
 * has been captured and not yet consumed).
 */
export function isInstallable(): boolean {
  attachWindowListeners();
  return deferredPrompt !== null;
}

/**
 * Show the browser's native install prompt, if one is stashed.
 * Resolves "unavailable" when there is no prompt to show or it fails.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  attachWindowListeners();
  const event = deferredPrompt;
  if (!event || typeof event.prompt !== "function") return "unavailable";
  try {
    await event.prompt();
    const choice = await event.userChoice;
    deferredPrompt = null;
    notifyInstallableChange(false);
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  }
}

/**
 * Subscribe to installable-state changes. Returns an unsubscribe function.
 */
export function onInstallableChange(
  callback: InstallableChangeCallback
): () => void {
  attachWindowListeners();
  changeListeners.add(callback);
  return () => {
    changeListeners.delete(callback);
  };
}

/**
 * Whether the app is running in installed/standalone mode
 * (display-mode standalone, or iOS `navigator.standalone`).
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    /* matchMedia unavailable or throws */
  }
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return nav?.standalone === true;
  } catch {
    return false;
  }
}

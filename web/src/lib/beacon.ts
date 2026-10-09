/** Client error beacon — POST /api/client-error. Fire-and-forget, never throws. */

const BUILD = "m1-client";

export function beaconError(message: string, where?: string, stack?: string) {
  try {
    const payload = JSON.stringify({
      message: String(message).slice(0, 1000),
      stack: stack ? String(stack).slice(0, 4000) : undefined,
      where,
      url: typeof location !== "undefined" ? location.href : undefined,
      build: BUILD,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/client-error",
        new Blob([payload], { type: "application/json" })
      );
    } else {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* beacon must never break the app */
  }
}

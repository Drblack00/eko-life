import { useEffect, useState } from "react";

/** Keep the final frame mounted for a compositor-only exit; rapid reopen cancels it. */
export function usePresence(open: boolean, duration = 220): boolean {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setRetained(false); return; }
    const timer = window.setTimeout(() => setRetained(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return open || retained;
}

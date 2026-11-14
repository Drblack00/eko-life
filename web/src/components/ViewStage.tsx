import { useEffect, useRef, useState, type AriaRole, type ReactNode } from "react";

/** Exit the current view before mounting the next one. No duplicate game views,
 * offscreen render loops, or measured layout; rapid navigation cancels the exit. */
export function ViewStage({ viewKey, children, className, as: Element = "div", role }: {
  viewKey: string; children: ReactNode; className?: string; as?: "main" | "div"; role?: AriaRole;
}) {
  const [shown, setShown] = useState(viewKey);
  const [exiting, setExiting] = useState(false);
  const last = useRef(children);
  if (shown === viewKey) last.current = children;
  useEffect(() => {
    if (viewKey === shown) { setExiting(false); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(viewKey); setExiting(false); return;
    }
    setExiting(true);
    const timer = window.setTimeout(() => { setShown(viewKey); setExiting(false); }, 160);
    return () => window.clearTimeout(timer);
  }, [viewKey, shown]);
  return <Element role={role} key={shown} className={`eko-viewstage ${className ?? ""}`} data-phase={exiting ? "exit" : "enter"} inert={exiting}>
    {shown === viewKey ? children : last.current}
  </Element>;
}

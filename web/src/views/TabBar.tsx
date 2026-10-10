import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

export type Tab =
  | "home"
  | "city"
  | "jobs"
  | "needs"
  | "daily"
  | "market"
  | "chat"
  | "friends"
  | "me";

export const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "city", label: "City", icon: "🌆" },
  { id: "jobs", label: "Jobs", icon: "💼" },
  { id: "needs", label: "Needs", icon: "💚" },
  { id: "daily", label: "Daily", icon: "🎯" },
  { id: "market", label: "Market", icon: "💰" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "friends", label: "Friends", icon: "🤝" },
  { id: "me", label: "Me", icon: "🧑" },
];

/**
 * Bottom tab bar: floating frosted dock with a liquid active-tab indicator.
 *
 * The indicator is a single pill that FLIP-slides between tab buttons with
 * a liquid mid-flight stretch (iOS Liquid Glass feel). The animation runs on
 * the Web Animations API and is transform-only — no layout thrash, 60fps on
 * iPhone. `will-change` is set on the pill only while it is animating.
 * Under prefers-reduced-motion the pill jumps instantly instead of sliding.
 */
export function TabBar({
  tab,
  onTab,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const btnRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const geomRef = useRef<{ x: number; w: number } | null>(null);
  const animRef = useRef<Animation | null>(null);
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  /** Seat the pill exactly behind the active button — no animation. */
  const placeInstant = useCallback((active: Tab) => {
    const nav = navRef.current;
    const pill = pillRef.current;
    const btn = btnRefs.current[active];
    if (!nav || !pill || !btn) return;
    const navBox = nav.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    const x = btnBox.left - navBox.left;
    const w = btnBox.width;
    geomRef.current = { x, w };
    animRef.current?.cancel();
    animRef.current = null;
    pill.style.willChange = "auto";
    pill.style.width = `${w}px`;
    pill.style.transform = `translate3d(${x}px, 0, 0) scaleX(1)`;
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    const btn = btnRefs.current[tab];
    if (!nav || !pill || !btn) return;
    const navBox = nav.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    const x = btnBox.left - navBox.left;
    const w = btnBox.width;
    const prev = geomRef.current;
    geomRef.current = { x, w };
    animRef.current?.cancel();
    animRef.current = null;

    if (!prev || reduceMotion) {
      // First paint or reduced motion: place the pill instantly.
      pill.style.willChange = "auto";
      pill.style.width = `${w}px`;
      pill.style.transform = `translate3d(${x}px, 0, 0) scaleX(1)`;
      return;
    }

    // FLIP: start from the previous button's box, fly to the new one.
    pill.style.width = `${w}px`;
    const dx = x - prev.x;
    // Liquid stretch — the pill bulges mid-flight, wider on longer jumps.
    const stretch = 1 + Math.min(0.28, Math.abs(dx) / 700);
    const midX = prev.x + dx * 0.55;
    const keyframes: Keyframe[] = [
      {
        transform: `translate3d(${prev.x}px, 0, 0) scaleX(${prev.w / w})`,
        offset: 0,
      },
      {
        transform: `translate3d(${midX}px, 0, 0) scaleX(${stretch})`,
        offset: 0.5,
      },
      { transform: `translate3d(${x}px, 0, 0) scaleX(1)`, offset: 1 },
    ];
    pill.style.willChange = "transform";
    const anim = pill.animate(keyframes, {
      duration: 380,
      easing: "cubic-bezier(0.30, 1.35, 0.52, 1)",
      fill: "forwards",
    });
    animRef.current = anim;
    const settle = () => {
      try {
        anim.commitStyles();
      } catch {
        /* Older engines: fall back to the plain final transform. */
        pill.style.transform = `translate3d(${x}px, 0, 0) scaleX(1)`;
      }
      anim.cancel();
      pill.style.willChange = "auto";
      if (animRef.current === anim) animRef.current = null;
    };
    anim.onfinish = settle;
    anim.oncancel = () => {
      if (animRef.current === anim) animRef.current = null;
    };
  }, [tab, reduceMotion, placeInstant]);

  // Rotation / viewport changes: re-seat the pill instantly — animating here
  // would fight the layout change.
  useEffect(() => {
    const onResize = () => placeInstant(tab);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [tab, placeInstant]);

  return (
    <nav className="eko-tabs" aria-label="Game sections" ref={navRef}>
      <span className="eko-tabs__pill" ref={pillRef} aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          ref={(el) => {
            btnRefs.current[t.id] = el;
          }}
          className={`eko-tabs__btn ${
            tab === t.id ? "eko-tabs__btn--active" : ""
          }`}
          aria-current={tab === t.id ? "page" : undefined}
          onClick={() => onTab(t.id)}
        >
          <span className="eko-tabs__icon" aria-hidden="true">
            {t.icon}
          </span>
          <span className="eko-tabs__label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

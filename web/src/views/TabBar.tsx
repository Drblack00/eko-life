import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

/**
 * Dock contract (2026-10-11 nav restructure): exactly 4 tabs — Home, Buy,
 * Map, Phone. Everything else lives inside the Phone slide-over as apps.
 */
export type Tab = "home" | "buy" | "map" | "phone";

export const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "buy", label: "Buy", icon: "🛒" },
  { id: "map", label: "Map", icon: "🗺️" },
  { id: "phone", label: "Phone", icon: "📱" },
];

/**
 * How much larger the selected tab's icon+label render inside the bubble,
 * measured against the iOS Liquid Glass reference video (selected content
 * reads ~1.2–1.3x the unselected size through the magnifier lens).
 */
export const TAB_ZOOM = 1.28;

/**
 * Breathing room the bubble keeps around the (zoomed) content. Wider than
 * tall, like the reference lens: the bubble reads as a horizontal blob
 * hugging the icon+label pair.
 */
const PILL_PAD_X = 22;
const PILL_PAD_Y = 7;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Bottom tab bar: floating frosted dock with a magnifying liquid-glass
 * bubble around the selected tab — icon ABOVE label, the pair inside the
 * bubble rendered TAB_ZOOM larger than the unselected tabs.
 *
 * The bubble is a single absolutely-positioned lens that FLIP-morphs between
 * tabs: position + size animate on the Web Animations API (transform-only,
 * 60fps on iPhone) with a mid-flight liquid stretch along the travel
 * direction and a spring easing. `will-change` is set on the pill only while
 * it is animating. Under prefers-reduced-motion the pill jumps instantly.
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
  const geomRef = useRef<Box | null>(null);
  const animRef = useRef<Animation | null>(null);
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  /**
   * The bubble's target box: the active button's content column (icon above
   * label), expanded around its center by TAB_ZOOM plus padding. Measured
   * with offset* (layout values — immune to the content's own scale
   * transform), walking the offsetParent chain up to the nav.
   */
  const targetBox = useCallback((active: Tab): Box | null => {
    const nav = navRef.current;
    const btn = btnRefs.current[active];
    if (!nav || !btn) return null;
    const content = btn.querySelector(".eko-tabs__content") as HTMLElement | null;
    if (!content) return null;
    let x = content.offsetLeft;
    let y = content.offsetTop;
    let el = content.offsetParent as HTMLElement | null;
    while (el && el !== nav) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    const w = content.offsetWidth;
    const h = content.offsetHeight;
    if (w === 0 || h === 0) return null;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const bw = w * TAB_ZOOM + PILL_PAD_X * 2;
    const bh = h * TAB_ZOOM + PILL_PAD_Y * 2;
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  }, []);

  /** Seat the bubble exactly around the active tab — no animation. */
  const placeInstant = useCallback(
    (active: Tab) => {
      const pill = pillRef.current;
      const box = targetBox(active);
      if (!pill || !box) return;
      geomRef.current = box;
      animRef.current?.cancel();
      animRef.current = null;
      pill.style.willChange = "auto";
      pill.style.width = `${box.w}px`;
      pill.style.height = `${box.h}px`;
      pill.style.transform = `translate3d(${box.x}px, ${box.y}px, 0) scale(1, 1)`;
    },
    [targetBox]
  );

  useLayoutEffect(() => {
    const pill = pillRef.current;
    const box = targetBox(tab);
    if (!pill || !box) return;
    const prev = geomRef.current;
    geomRef.current = box;
    animRef.current?.cancel();
    animRef.current = null;

    if (!prev || reduceMotion) {
      // First paint or reduced motion: seat the bubble instantly.
      pill.style.willChange = "auto";
      pill.style.width = `${box.w}px`;
      pill.style.height = `${box.h}px`;
      pill.style.transform = `translate3d(${box.x}px, ${box.y}px, 0) scale(1, 1)`;
      return;
    }

    // FLIP: start from the previous tab's bubble box, fly to the new one.
    // transform-origin is left/top (see Game.css), so scale factors are
    // exact ratios of the two boxes.
    pill.style.width = `${box.w}px`;
    pill.style.height = `${box.h}px`;
    const dx = box.x - prev.x;
    const dy = box.y - prev.y;
    const dist = Math.hypot(dx, dy);
    // Liquid mid-flight: stretch along the travel direction, squash across
    // it — the bubble visibly elongates between the tabs, never rigid.
    const stretch = 1 + Math.min(0.38, dist / 550);
    const squash = 1 - Math.min(0.16, dist / 1500);
    const midX = prev.x + dx * 0.5;
    const midY = prev.y + dy * 0.5;
    const keyframes: Keyframe[] = [
      {
        transform: `translate3d(${prev.x}px, ${prev.y}px, 0) scale(${
          prev.w / box.w
        }, ${prev.h / box.h})`,
        offset: 0,
      },
      {
        transform: `translate3d(${midX}px, ${midY}px, 0) scale(${stretch}, ${squash})`,
        offset: 0.55,
      },
      {
        transform: `translate3d(${box.x}px, ${box.y}px, 0) scale(1, 1)`,
        offset: 1,
      },
    ];
    pill.style.willChange = "transform";
    const anim = pill.animate(keyframes, {
      duration: 420,
      easing: "cubic-bezier(0.32, 1.45, 0.45, 1)",
      fill: "forwards",
    });
    animRef.current = anim;
    const settle = () => {
      try {
        anim.commitStyles();
      } catch {
        /* Older engines: fall back to the plain final transform. */
        pill.style.transform = `translate3d(${box.x}px, ${box.y}px, 0) scale(1, 1)`;
      }
      anim.cancel();
      pill.style.willChange = "auto";
      if (animRef.current === anim) animRef.current = null;
    };
    anim.onfinish = settle;
    anim.oncancel = () => {
      if (animRef.current === anim) animRef.current = null;
    };
  }, [tab, reduceMotion, targetBox]);

  // Rotation / viewport changes: re-seat the bubble instantly — animating here
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
          aria-label={t.label}
          onClick={() => onTab(t.id)}
        >
          <span className="eko-tabs__content">
            <span className="eko-tabs__icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="eko-tabs__label" aria-hidden="true">
              {t.label}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}

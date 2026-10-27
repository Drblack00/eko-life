import { useLayoutEffect, useRef, useState } from "react";

/**
 * Stroke-SVG tab icons (original artwork, 24x24 grid) — the four icons the
 * old tab bar used from the shared components/Icon set. The shared Icon
 * component was removed from the tree after the liquid-glass tab bar was
 * written, so the tab bar carries its own copy with identical artwork and
 * the same name/size API. No new visual language: same paths, same
 * currentColor strokes.
 */
type IconName = "home" | "shopping-bag" | "map" | "smartphone";

const ICON_PATHS: Record<IconName, React.JSX.Element> = {
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  "shopping-bag": (
    <>
      <path d="M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15m6-12v15" />
    </>
  ),
  smartphone: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/**
 * Bottom dock — "Èkó Way" redesign (2026-10-27, from the approved
 * hub + dock samples).
 *
 * Fixed bottom glass dock: 5 slots — Home · Buy · raised centre Èkó
 * character · Map · Phone. Tab ids and routing are unchanged (the centre
 * button opens the character panel, the same destination as the hub
 * avatar). A glider bubble slides under the active tab with spring
 * easing; the centre face is the player's real avatar on their colour.
 * Styling lives in HubDock.css + styles/themes.css.
 */
export type Tab = "home" | "buy" | "map" | "phone";

export const TABS: Array<{ id: Tab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "buy", label: "Buy" },
  { id: "map", label: "Map" },
  { id: "phone", label: "Phone" },
];

const TAB_ICONS: Record<Tab, IconName> = {
  home: "home",
  buy: "shopping-bag",
  map: "map",
  phone: "smartphone",
};

interface GliderBox {
  left: number;
  width: number;
  show: boolean;
}

export function TabBar({
  tab,
  onTab,
  hasUnread = false,
  centreAvatar,
  centreColor,
  onCentre,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** Shows the red notification dot on the Phone tab. */
  hasUnread?: boolean;
  /** The player's real avatar glyph + colour for the raised centre face. */
  centreAvatar?: string;
  centreColor?: string;
  /** Opens the character panel (Èkó home). Centre button hides without it. */
  onCentre?: () => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const [glider, setGlider] = useState<GliderBox>({ left: 0, width: 0, show: false });

  // Measure the active tab and slide the glider bubble under it. Runs on
  // tab change, mount and resize; the CSS transition supplies the spring.
  useLayoutEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      const btn = itemRefs.current.get(tab);
      if (!nav || !btn) {
        setGlider((g) => ({ ...g, show: false }));
        return;
      }
      const navBox = nav.getBoundingClientRect();
      const box = btn.getBoundingClientRect();
      setGlider({
        left: box.left - navBox.left + 4,
        width: Math.max(box.width - 8, 0),
        show: box.width > 0,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab, onCentre]);

  return (
    <nav className="mobile-nav" aria-label="Game sections" ref={navRef}>
      <span
        className="mobile-nav__glider"
        aria-hidden="true"
        style={{
          transform: `translateX(${glider.left}px)`,
          width: glider.width,
          opacity: glider.show ? 1 : 0,
        }}
      />
      {TABS.flatMap((t) => {
        const active = tab === t.id;
        const btn = (
          <button
            key={t.id}
            ref={(el) => {
              if (el) itemRefs.current.set(t.id, el);
              else itemRefs.current.delete(t.id);
            }}
            type="button"
            className="nav-item"
            aria-current={active ? "page" : undefined}
            aria-label={t.label}
            onClick={() => onTab(t.id)}
          >
            <Icon name={TAB_ICONS[t.id]} size={20} />
            <span>{t.label}</span>
            {t.id === "phone" && hasUnread && (
              <span className="nav-dot" aria-hidden="true" />
            )}
          </button>
        );
        // The raised centre Èkó button rides between Buy and Map.
        if (t.id === "map" && onCentre) {
          return [
            <button
              key="centre"
              type="button"
              className="nav-centre"
              aria-label="My character — Èkó home"
              title="My character"
              onClick={onCentre}
            >
              <span
                className="nav-centre__face"
                style={centreColor ? { backgroundColor: centreColor } : undefined}
                aria-hidden="true"
              >
                {centreAvatar ?? "🙂"}
              </span>
              <span>Èkó</span>
            </button>,
            btn,
          ];
        }
        return [btn];
      })}
    </nav>
  );
}

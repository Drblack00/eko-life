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
 * Bottom tab bar — liquid-glass redesign (2026-10-13).
 *
 * Fixed bottom glass bar in the prototype's mobile-nav language: 5-slot
 * grid, SVG icons + visible labels, active tab gets the accent pill.
 * Tab ids and routing are unchanged — only the visuals moved.
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

export function TabBar({
  tab,
  onTab,
  hasUnread = false,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** Shows the red notification dot on the Phone tab. */
  hasUnread?: boolean;
}) {
  return (
    <nav className="mobile-nav" aria-label="Game sections">
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
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
      })}
    </nav>
  );
}

import { Icon, type IconName } from "../components";

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

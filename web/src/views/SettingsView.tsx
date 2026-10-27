import { useState } from "react";
import type { NotificationPrefs } from "../game/types";
import { NOTIFICATION_PREF_LABELS } from "../game/types";
import { THEMES, useTheme, type ThemeId } from "../theme/theme";
import { Icon, type IconName } from "../components";
import "./SettingsView.css";

interface SettingsViewProps {
  displayName: string;
  username: string;
  // Toggles
  notifPrefs: NotificationPrefs | null;
  onNotifPrefs: (patch: Partial<NotificationPrefs>) => void;
  soundOn: boolean;
  onToggleSound: () => void;
  musicOn: boolean;
  onToggleMusic: () => void;
  nightModeOn: boolean;
  onToggleNightMode: () => void;
  // Actions
  onEdit: () => void;
  onTheme: () => void;
  onLanguage: () => void;
  onHelp: () => void;
  onRate: () => void;
  onShare: () => void;
  onLogout: () => void;
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`eko-settings-toggle${on ? " eko-settings-toggle--on" : ""}`}
      onClick={onClick}
    >
      <span className="eko-settings-toggle__knob" aria-hidden="true" />
    </button>
  );
}

/** Appearance — 6 theme cards with swatch dots. Persisted via localStorage. */
function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const select = (id: ThemeId) => setTheme(id);
  return (
    <section className="eko-settings__card eko-settings__appearance" aria-label="Appearance">
      <h2 className="eko-settings__section-title">Appearance</h2>
      <div className="eko-theme-cards" role="radiogroup" aria-label="Color theme">
        {THEMES.map((t) => {
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`eko-theme-card${active ? " eko-theme-card--active" : ""}`}
              onClick={() => select(t.id)}
            >
              <span className="eko-theme-card__swatches" aria-hidden="true">
                {t.swatches.map((c) => (
                  <span
                    key={c}
                    className="eko-theme-card__swatch"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <span className="eko-theme-card__name">{t.name}</span>
              <span className="eko-theme-card__blurb">{t.blurb}</span>
              {active && (
                <span className="eko-theme-card__check" aria-hidden="true">
                  <Icon name="check" size={18} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function SettingsView(props: SettingsViewProps) {
  const {
    displayName,
    username,
    notifPrefs,
    onNotifPrefs,
    soundOn,
    onToggleSound,
    musicOn,
    onToggleMusic,
    nightModeOn,
    onToggleNightMode,
    onEdit,
    onTheme,
    onLanguage,
    onHelp,
    onRate,
    onShare,
    onLogout,
  } = props;

  // Notifications master toggle — on if any notification pref is enabled.
  const notifOn = notifPrefs
    ? Object.keys(NOTIFICATION_PREF_LABELS).some(
        (k) => notifPrefs[k as keyof NotificationPrefs] !== false
      )
    : true;
  const toggleNotifications = () => {
    const patch: Partial<NotificationPrefs> = {};
    for (const k of Object.keys(NOTIFICATION_PREF_LABELS) as Array<
      keyof NotificationPrefs
    >) {
      patch[k] = !notifOn;
    }
    onNotifPrefs(patch);
  };

  const menuRows: Array<{ icon: IconName; label: string; onClick: () => void }> = [
    { icon: "eye", label: "Theme", onClick: onTheme },
    { icon: "messages", label: "Language", onClick: onLanguage },
    { icon: "help", label: "Help & guide", onClick: onHelp },
    { icon: "sparkles", label: "Rate the game", onClick: onRate },
    { icon: "share", label: "Share", onClick: onShare },
  ];

  return (
    <div className="eko-settings">
      <div className="eko-settings__brand">Èkó Life</div>
      <h1 className="eko-settings__title">Settings</h1>

      <AppearanceSection />

      <div className="eko-settings__card eko-settings__profile">
        <div className="eko-settings__avatar" aria-hidden="true">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="eko-settings__profile-text">
          <div className="eko-settings__name">{displayName}</div>
          <div className="eko-settings__handle">@{username}</div>
        </div>
        <button
          type="button"
          className="eko-settings__edit"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>

      <div className="eko-settings__card">
        <div className="eko-settings__row">
          <span className="eko-settings__icon" aria-hidden="true">
            <Icon name="bell" />
          </span>
          <span className="eko-settings__label">Notifications</span>
          <Toggle on={notifOn} onClick={toggleNotifications} label="Notifications" />
        </div>
        <div className="eko-settings__row">
          <span className="eko-settings__icon" aria-hidden="true">
            <Icon name="music" />
          </span>
          <span className="eko-settings__label">Music</span>
          <Toggle on={musicOn} onClick={onToggleMusic} label="Music" />
        </div>
        <div className="eko-settings__row">
          <span className="eko-settings__icon" aria-hidden="true">
            <Icon name="volume" />
          </span>
          <span className="eko-settings__label">Sound effects</span>
          <Toggle on={soundOn} onClick={onToggleSound} label="Sound effects" />
        </div>
        <div className="eko-settings__row eko-settings__row--last">
          <span className="eko-settings__icon" aria-hidden="true">
            <Icon name="moon" />
          </span>
          <span className="eko-settings__label">Night mode</span>
          <Toggle on={nightModeOn} onClick={onToggleNightMode} label="Night mode" />
        </div>
      </div>

      <div className="eko-settings__card">
        {menuRows.map((row) => (
          <button
            key={row.label}
            type="button"
            className="eko-settings__row eko-settings__menurow"
            onClick={row.onClick}
          >
            <span className="eko-settings__icon" aria-hidden="true">
              <Icon name={row.icon} />
            </span>
            <span className="eko-settings__label">{row.label}</span>
            <span className="eko-settings__chevron" aria-hidden="true">
              <Icon name="chevron-right" size={18} />
            </span>
          </button>
        ))}
        <button
          type="button"
          className="eko-settings__logout"
          onClick={onLogout}
        >
          Log out
        </button>
      </div>
    </div>
  );
}

// Local storage helpers for Music and Night mode toggles.
const MUSIC_KEY = "eko-setting-music";
const NIGHT_KEY = "eko-setting-night";

export function readMusicOn(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeMusicOn(on: boolean): void {
  try {
    localStorage.setItem(MUSIC_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

export function readNightModeOn(): boolean {
  try {
    return localStorage.getItem(NIGHT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeNightModeOn(on: boolean): void {
  try {
    localStorage.setItem(NIGHT_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

export function useMusicToggle(): [boolean, () => void] {
  const [on, setOn] = useState(readMusicOn);
  const toggle = () => {
    const next = !on;
    setOn(next);
    writeMusicOn(next);
  };
  return [on, toggle];
}

export function useNightModeToggle(): [boolean, () => void] {
  const [on, setOn] = useState(readNightModeOn);
  const toggle = () => {
    const next = !on;
    setOn(next);
    writeNightModeOn(next);
  };
  return [on, toggle];
}

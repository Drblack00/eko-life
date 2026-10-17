// PORT-P4: social — social preferences block for the Me panel's
// ⚙️ Settings card (the live settings surface). Read receipts,
// "who can message me" (everyone / friends only), and relationships
// visibility — all persisted server-side at /api/social/settings.
import { useEffect, useState } from "react";
import { ApiError, socialApi, type SocialSettings } from "../../lib/api";
import { useToast } from "../../components";

function Switch({
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
      className={`eko-switch${on ? " eko-switch--on" : ""}`}
      onClick={onClick}
    >
      <span className="eko-switch__knob" aria-hidden="true" />
    </button>
  );
}

export function SocialSettingsBlock({ token }: { token: string }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SocialSettings | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await socialApi.getSettings(token);
        if (alive) setSettings(r.settings);
      } catch {
        /* social prefs stay hidden rather than broken */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const save = async (patch: Partial<SocialSettings>) => {
    const prev = settings;
    if (prev) setSettings({ ...prev, ...patch });
    try {
      const r = await socialApi.putSettings(token, patch);
      setSettings(r.settings);
    } catch (err) {
      if (prev) setSettings(prev);
      toast(
        err instanceof ApiError ? err.message : "Couldn't save the setting.",
        "error"
      );
    }
  };

  if (!settings) return null;

  return (
    <div className="eko-me__notifprefs">
      <h3 className="eko-me__notifprefs-title">💬 Social</h3>
      <label className="eko-me__notifpref">
        <span className="eko-me__notifpref-text">
          <strong>Read receipts</strong>
          <small>Let others see when you've read their DMs</small>
        </span>
        <Switch
          on={settings.read_receipts}
          onClick={() => void save({ read_receipts: !settings.read_receipts })}
          label="Read receipts"
        />
      </label>
      <div className="eko-me__notifpref">
        <span className="eko-me__notifpref-text">
          <strong>Who can message me</strong>
          <small>
            {settings.message_policy === "friends"
              ? "Only friends — strangers get turned away"
              : "Everyone — strangers' first messages wait in requests"}
          </small>
        </span>
        <div className="eko-seg" role="group" aria-label="Who can message me">
          {(["everyone", "friends"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`eko-seg__opt${
                settings.message_policy === opt ? " eko-seg__opt--on" : ""
              }`}
              aria-pressed={settings.message_policy === opt}
              onClick={() => void save({ message_policy: opt })}
            >
              {opt === "everyone" ? "Everyone" : "Friends"}
            </button>
          ))}
        </div>
      </div>
      <label className="eko-me__notifpref">
        <span className="eko-me__notifpref-text">
          <strong>Show my relationships</strong>
          <small>Family & dating badges visible on your profile</small>
        </span>
        <Switch
          on={settings.relationships_visible}
          onClick={() =>
            void save({ relationships_visible: !settings.relationships_visible })
          }
          label="Show my relationships"
        />
      </label>
    </div>
  );
}

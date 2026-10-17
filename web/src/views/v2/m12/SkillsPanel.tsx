import { useEffect, useMemo, useState } from "react";
import { Card } from "../../../components/Card";
import { Button } from "../../../components/Button";
import { StatBar } from "../../../components/StatBar";
import "./m12.css";

/* Types shared by both panels. `send` is the sendAct-style function:
   send("train", { skill: "fitness" }). `messages` is an optional pass-
   through of recent raw server messages (coordinator wiring); when
   absent the panels render from the `you` snapshot (see MOUNT spec). */

export interface M12Props {
  you: any;
  send: (a: string, params?: Record<string, unknown>) => void;
  api?: any;
  messages?: any[];
}

function latestOf(messages: any[] | undefined, t: string): any {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].t === t) return messages[i];
  }
  return null;
}

export interface SkillRow {
  id: string;
  name: string;
  icon: string;
  xp: number;
  level: number;
  xpNext: number;
  effective: number;
  rust: number;
  certified: boolean;
  trainFee: number;
  trainAt: string;
}

/** Shared skill definitions (name/icon/train info) for panels that render skills from the `you` snapshot. */
export const SKILL_FALLBACK: SkillRow[] = [
  { id: "cooking", name: "Cooking", icon: "🍲", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 500, trainAt: "markets" },
  { id: "charisma", name: "Charisma", icon: "✨", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 0, trainAt: "clubs & malls" },
  { id: "fitness", name: "Fitness", icon: "💪", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 0, trainAt: "stadiums" },
  { id: "coding", name: "Coding", icon: "💻", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 1000, trainAt: "tech hubs" },
  { id: "music", name: "Music", icon: "🎧", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 1500, trainAt: "clubs" },
  { id: "hustle", name: "Hustle", icon: "🔥", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 0, trainAt: "motor parks" },
  { id: "dance", name: "Dance", icon: "💃", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 500, trainAt: "beaches & clubs" },
  { id: "comedy", name: "Comedy", icon: "🎤", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 0, trainAt: "landmarks" },
  { id: "photography", name: "Photography", icon: "📸", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 1000, trainAt: "beaches & landmarks" },
  // PORT-P1: 10th skill
  { id: "fashion", name: "Fashion", icon: "👗", xp: 0, level: 0, xpNext: 100, effective: 0, rust: 0, certified: false, trainFee: 500, trainAt: "malls & markets" },
];

export function SkillsPanel({ you, send, messages }: M12Props) {
  const [live, setLive] = useState<SkillRow[] | null>(null);

  useEffect(() => {
    send("skills", {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const msg = latestOf(messages, "skills");
  useEffect(() => {
    if (msg && Array.isArray(msg.skills)) setLive(msg.skills);
  }, [msg]);

  const skills: SkillRow[] = useMemo(() => {
    if (live) return live;
    if (you && Array.isArray(you.skills)) return you.skills;
    return SKILL_FALLBACK;
  }, [live, you]);

  const energy = Number(you?.energy ?? 0);

  return (
    <div className="m12-wrap">
      <div className="m12-head">
        <h2 className="m12-title">Skills</h2>
        <p className="m12-sub">
          Train around the city to level up. Skip a skill for 7+ days and it
          starts to rust — about 1 level per 20 idle days, max 2.
        </p>
      </div>
      <div className="m12-skill-grid">
        {skills.map((s) => {
          const pct = s.xpNext > 0 ? Math.min(100, Math.round((s.xp / s.xpNext) * 100)) : 0;
          const canTrain = energy >= 15;
          return (
            <Card key={s.id} className="m12-skill-card">
              <div className="m12-skill-top">
                <span className="m12-skill-icon" aria-hidden="true">{s.icon}</span>
                <div className="m12-skill-name">
                  <strong>{s.name}</strong>
                  <span className="m12-skill-lvl">
                    Lv {s.level}
                    {s.effective !== s.level && (
                      <span className="m12-eff" title="Effective level for career gates">
                        {" "}→ {s.effective} eff.
                      </span>
                    )}
                    {s.certified && <span className="m12-cert" title="Academy certificate: +1 effective level"> 🎓</span>}
                  </span>
                </div>
              </div>
              <div className="m12-xpbar">
                <StatBar label="XP" value={pct} icon="✨" />
              </div>
              <div className="m12-skill-xp">{s.xp}/{s.xpNext} XP</div>
              {s.rust > 0 && (
                <div className="m12-rust">🥀 Rusting −{s.rust} — train it soon!</div>
              )}
              <div className="m12-train-hint">📍 Train at {s.trainAt}{s.trainFee > 0 ? ` · ₦${s.trainFee.toLocaleString("en-NG")}` : " · free"}</div>
              <Button
                className="m12-train-btn"
                disabled={!canTrain}
                onClick={() => send("train", { skill: s.id })}
              >
                Train (15⚡)
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

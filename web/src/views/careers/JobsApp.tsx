import { useState } from "react";
import { JobsTab, type JobsTabYou, type ShiftTrackInfo } from "../v2/m7";
import { SkillsPanel, AcademyView } from "../v2/m12";
import { CareerHub } from "./CareerHub";
import "./careers.css";

export interface JobsAppProps {
  you: JobsTabYou;
token: string;
  /** JobsTab-style sender: (msg) => socket.send(...) */
  sendMsg: (msg: Record<string, unknown>) => void;
  /** M12-style sender: (a, params) => sock.sendAct(a, params) */
  sendAct: (a: string, params?: Record<string, unknown>) => void;
  careerTracks?: ShiftTrackInfo[];
  skillLabels?: Record<string, string>;
  locationName?: (id: string) => string;
}

function skillsOf(you: JobsTabYou): Record<string, number> | null {
  try {
    const s = you.skills;
    const obj = typeof s === "string" ? JSON.parse(s || "{}") : s || {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lvl = Number(v && typeof v === "object" ? (v as { level?: number }).level : v);
      if (Number.isFinite(lvl) && lvl > 0) out[k] = Math.floor(lvl);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Phone "Jobs" app — the existing role list ("Roles") beside the P3
 * career system ("Careers"). Owns the sub-tab state so Game.tsx stays
 * a one-component render.
 */
export function JobsApp({ you, token, sendMsg, sendAct, careerTracks, skillLabels, locationName }: JobsAppProps) {
  const [tab, setTab] = useState<"roles" | "careers">("roles");
  return (
    <div className="eko-tabpad">
      {/* PORT-P3: careers — begin (sub-tabs: existing roles vs the career ladder) */}
      <div className="p3-tabs p3-tabs--jobs" role="tablist" aria-label="Jobs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "roles"}
          className={`p3-tab${tab === "roles" ? " p3-tab--on" : ""}`}
          onClick={() => setTab("roles")}
        >
          🕘 Shifts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "careers"}
          className={`p3-tab${tab === "careers" ? " p3-tab--on" : ""}`}
          onClick={() => setTab("careers")}
        >
          💼 Careers
        </button>
      </div>
      {tab === "careers" ? (
        <CareerHub
          token={token}
          send={sendMsg}
          skills={skillsOf(you)}
          hasCert={Number(you.cert) > 0}
        />
      ) : (
        <>
          <JobsTab
            you={you}
            send={sendMsg}
            careerTracks={careerTracks}
            skillLabels={skillLabels}
            locationName={locationName}
          />
          <SkillsPanel you={you} send={sendAct} />
          <AcademyView you={you} send={sendAct} />
        </>
      )}
      {/* PORT-P3: careers — end */}
    </div>
  );
}

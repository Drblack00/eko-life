import { useEffect, useState } from "react";
import { MyCareer } from "./MyCareer";
import { CareersBrowser } from "./CareersBrowser";
import { careersApi } from "./api";
import "./careers.css";

export interface CareerHubProps {
token: string;
  /** raw WS sender for shift_start clock-in */
  send: (msg: Record<string, unknown>) => void;
  /** viewer skills for lock display, e.g. from the M12 academy snapshot */
  skills?: Record<string, number> | null;
  hasCert?: boolean;
}

type Tab = "mine" | "browse";

/** Sub-tabs inside the phone's Jobs app: existing role list lives beside these. */
export function CareerHub({ token, send, skills, hasCert }: CareerHubProps) {
  const [tab, setTab] = useState<Tab>("mine");
  const [currentCareerId, setCurrentCareerId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await careersApi.me(token);
        if (alive) setCurrentCareerId(st.employed ? st.careerId ?? null : null);
      } catch {
        /* browser still works without it */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div>
      <div className="p3-tabs" role="tablist" aria-label="Careers">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mine"}
          className={`p3-tab${tab === "mine" ? " p3-tab--on" : ""}`}
          onClick={() => setTab("mine")}
        >
          💼 My Career
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "browse"}
          className={`p3-tab${tab === "browse" ? " p3-tab--on" : ""}`}
          onClick={() => setTab("browse")}
        >
          🔍 Find Work
        </button>
      </div>
      {tab === "mine" ? (
        <MyCareer token={token} send={send} onBrowse={() => setTab("browse")} />
      ) : (
        <CareersBrowser
          token={token}
          skills={skills}
          hasCert={hasCert}
          currentCareerId={currentCareerId}
          onApplied={() => {
            setTab("mine");
            careersApi
              .me(token)
              .then((st) => setCurrentCareerId(st.employed ? st.careerId ?? null : null))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}

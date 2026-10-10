import { useEffect, useState } from "react";
import "./m7.css";

/**
 * M7 game clock — real wall time in Africa/Lagos ("Sat · 3:16 AM").
 *
 * Props:
 *   label?: string  — when the coordinator wires the 30s WS `clock`
 *                     broadcast into app state, pass its label here and the
 *                     component becomes purely presentational.
 *   If no label is given, the component fetches GET /api/v2/m7/clock on
 *   mount and refreshes every 30s (self-contained fallback).
 */
export function Clock({ label: externalLabel }: { label?: string }) {
  const [label, setLabel] = useState<string>(externalLabel ?? "…");

  useEffect(() => {
    if (externalLabel !== undefined) {
      setLabel(externalLabel);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/v2/m7/clock");
        if (!r.ok) return;
        const j = (await r.json()) as { label?: string };
        if (alive && typeof j.label === "string") setLabel(j.label);
      } catch {
        /* clock stays on last known label */
      }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [externalLabel]);

  const parts = label.split("·").map((s) => s.trim());
  const datePart = parts.length > 1 ? parts[0] : "";
  const timePart = parts.length > 1 ? parts.slice(1).join(" · ") : label;

  return (
    <span className="m7-clock" role="timer" aria-label={`Game time: ${label}`}>
      <span aria-hidden="true">🕐</span>{" "}
      {datePart ? (
        <span className="m7-clock__date">{datePart} · </span>
      ) : null}
      {timePart}
    </span>
  );
}

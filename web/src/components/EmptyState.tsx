import type { ReactNode } from "react";
import "./EmptyState.css";

/** Friendly placeholder for content that arrives in a later milestone. */
export function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="eko-empty">
      <div className="eko-empty__emoji" aria-hidden="true">
        {emoji}
      </div>
      <h2 className="eko-empty__title">{title}</h2>
      {body && <p className="eko-empty__body">{body}</p>}
      {action && <div className="eko-empty__action">{action}</div>}
    </div>
  );
}

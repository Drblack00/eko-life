import type { ReactNode } from "react";
import "./Card.css";

export function Card({
  children,
  className = "",
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}) {
  return (
    <div className={`eko-card glass ${elevated ? "eko-card--elevated" : ""} ${className}`}>
      {children}
    </div>
  );
}

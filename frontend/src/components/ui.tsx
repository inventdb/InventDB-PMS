import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

import { toneForValue } from "../config/entities";

export function Spinner() {
  return (
    <div className="center-box">
      <div className="spinner" aria-label="Loading" role="status" />
    </div>
  );
}

export function Badge({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>—</>;
  return <span className={`badge ${toneForValue(value)}`}>{String(value)}</span>;
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon ?? <Inbox size={26} />}</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Alert({
  kind = "info",
  children,
}: {
  /** `warn` is for a result that stands but deserves a second look — an
   *  accepted workflow plan the engine still has reservations about. */
  kind?: "error" | "success" | "info" | "warn";
  children: ReactNode;
}) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

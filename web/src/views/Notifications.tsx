import { useEffect } from "react";
import { Sheet, Button, EmptyState } from "../components";
import {
  notificationIcon,
  type NotificationEntry,
} from "../game/types";
import "./Notifications.css";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Bell button with unread badge — lives in the main HUD top bar. */
export function NotificationBell({
  unread,
  onOpen,
}: {
  unread: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="eko-notifbell"
      onClick={onOpen}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
    >
      <span aria-hidden="true">🔔</span>
      {unread > 0 && (
        <span className="eko-notifbell__badge" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/** Notification list panel. Opening it clears the badge (mark-all-read). */
export function NotificationPanel({
  open,
  onClose,
  notifications,
  onTap,
  onMarkAllRead,
}: {
  open: boolean;
  onClose: () => void;
  notifications: NotificationEntry[];
  onTap: (n: NotificationEntry) => void;
  onMarkAllRead: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} label="🔔 Notifications">
      <div className="eko-notifs">
        {notifications.length > 0 && (
          <div className="eko-notifs__head">
            <Button size="md" variant="ghost" onClick={onMarkAllRead}>
              ✓ Mark all read
            </Button>
          </div>
        )}
        {notifications.length === 0 ? (
          <EmptyState
            emoji="🔕"
            title="All caught up"
            body="Friend logins, room messages and coin alerts will land here."
          />
        ) : (
          <ul className="eko-notifs__list">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`eko-notif ${n.read ? "eko-notif--read" : ""}`}
                  onClick={() => onTap(n)}
                >
                  <span className="eko-notif__icon" aria-hidden="true">
                    {notificationIcon(n.type)}
                  </span>
                  <span className="eko-notif__body">
                    <strong className="eko-notif__title">{n.title}</strong>
                    {n.body && <span className="eko-notif__text">{n.body}</span>}
                    <span className="eko-notif__time">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read && <span className="eko-notif__dot" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** Live toast popups for incoming notifications — tap to jump, auto-dismiss. */
export function NotificationToasts({
  toasts,
  onTap,
  onDismiss,
}: {
  toasts: NotificationEntry[];
  onTap: (n: NotificationEntry) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="eko-notiftoasts" aria-live="polite">
      {toasts.map((n) => (
        <ToastCard key={n.id} n={n} onTap={onTap} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  n,
  onTap,
  onDismiss,
}: {
  n: NotificationEntry;
  onTap: (n: NotificationEntry) => void;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(n.id), 6000);
    return () => window.clearTimeout(t);
  }, [n.id, onDismiss]);
  return (
    <button
      type="button"
      className="eko-notiftoast glass"
      onClick={() => {
        onDismiss(n.id);
        onTap(n);
      }}
    >
      <span className="eko-notiftoast__icon" aria-hidden="true">
        {notificationIcon(n.type)}
      </span>
      <span className="eko-notiftoast__body">
        <strong>{n.title}</strong>
        {n.body && <span className="eko-notiftoast__text">{n.body}</span>}
      </span>
      <span
        className="eko-notiftoast__x"
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(n.id);
        }}
      >
        ✕
      </span>
    </button>
  );
}

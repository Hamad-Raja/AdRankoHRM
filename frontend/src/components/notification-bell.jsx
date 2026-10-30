import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import {
  Bell,
  Check,
  CheckCheck,
  Megaphone,
  CalendarCheck,
  Receipt,
  Info,
  AlertTriangle,
  X,
  ExternalLink,
} from "lucide-react";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@/services/notification.service";
import { useAuth } from "@/context/auth-context";

function formatTimeAgo(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString();
}

function getNotificationIcon(type) {
  switch (type) {
    case "ANNOUNCEMENT":
      return <Megaphone className="size-4 text-primary" aria-hidden="true" />;
    case "ATTENDANCE":
      return <CalendarCheck className="size-4 text-emerald-500" aria-hidden="true" />;
    case "PAYROLL":
      return <Receipt className="size-4 text-indigo-500" aria-hidden="true" />;
    case "WARNING":
      return <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />;
    default:
      return <Info className="size-4 text-sky-500" aria-hidden="true" />;
  }
}

export default function NotificationBell() {
  const { getCsrfToken } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const containerRef = useRef(null);
  const navigate = useNavigate();

  const fetchCount = useCallback(async () => {
    try {
      const data = await getUnreadNotificationCount();
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Ignore background polling errors
    }
  }, []);

  const fetchRecent = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications({ page: 1, pageSize: 8 });
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Ignore popover fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll count every 30 seconds and on window focus
  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);

    function onFocus() {
      fetchCount();
    }
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchCount]);

  // Load notifications list when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchRecent();
    }
  }, [isOpen, fetchRecent]);

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleMarkRead(event, id) {
    event.stopPropagation();
    try {
      await markNotificationRead(id, { csrfToken: getCsrfToken() });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Non-blocking
    }
  }

  async function handleMarkAllRead() {
    if (actionPending) return;
    setActionPending(true);
    try {
      await markAllNotificationsRead({ csrfToken: getCsrfToken() });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Non-blocking
    } finally {
      setActionPending(false);
    }
  }

  async function handleDelete(event, id) {
    event.stopPropagation();
    try {
      await deleteNotification(id, { csrfToken: getCsrfToken() });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      fetchCount();
    } catch {
      // Non-blocking
    }
  }

  function handleNotificationClick(n) {
    if (!n.isRead) {
      markNotificationRead(n.id, { csrfToken: getCsrfToken() }).catch(() => {});
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setIsOpen(false);
    if (n.link) {
      navigate(n.link);
    }
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
            : "Notifications"
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="relative inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-background/80 text-foreground transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Bell className="size-4" aria-hidden="true" />

        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground shadow-xs animate-in zoom-in-75">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Recent notifications"
          className="absolute right-0 z-50 mt-2 w-80 sm:w-96 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl animate-in fade-in-50 zoom-in-95 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight">Notifications</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                disabled={actionPending}
                onClick={handleMarkAllRead}
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden disabled:opacity-50 transition-colors"
                title="Mark all as read"
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/50">
            {loading ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <div className="inline-block size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="mt-2">Loading notifications…</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="mx-auto size-8 text-muted-foreground/40 stroke-1" aria-hidden="true" />
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                  You're all caught up!
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  No notifications at the moment.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`group relative flex cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
                    !n.isRead ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="mt-0.5 shrink-0 rounded-full bg-background p-1.5 border border-border/80 shadow-2xs">
                    {getNotificationIcon(n.type)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-xs leading-snug font-medium line-clamp-1 ${
                          !n.isRead ? "text-foreground font-semibold" : "text-muted-foreground"
                        }`}
                      >
                        {n.title}
                      </p>

                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatTimeAgo(n.createdAt)}
                      </span>
                    </div>

                    <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {n.message}
                    </p>

                    {n.link && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                        View details
                        <ExternalLink className="size-2.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={(e) => handleMarkRead(e, n.id)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-hidden"
                        title="Mark as read"
                        aria-label="Mark as read"
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, n.id)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-hidden"
                      title="Delete notification"
                      aria-label="Delete notification"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  {!n.isRead && (
                    <span
                      className="absolute top-4 right-2 size-2 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/80 bg-muted/20 px-4 py-2.5">
            <Link
              to="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all notifications →
            </Link>

            <Link
              to="/announcements"
              onClick={() => setIsOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Announcements
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

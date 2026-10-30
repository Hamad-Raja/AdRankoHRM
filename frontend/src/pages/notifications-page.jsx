import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  Megaphone,
  CalendarCheck,
  Receipt,
  Info,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearReadNotifications,
} from "@/services/notification.service";
import { useAuth } from "@/context/auth-context";

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

export default function NotificationsPage() {
  const { getCsrfToken } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filterType, setFilterType] = useState("ALL"); // 'ALL' | 'UNREAD' | 'ANNOUNCEMENT' | 'ATTENDANCE' | 'PAYROLL'
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { page, pageSize };
      if (filterType === "UNREAD") {
        params.unreadOnly = true;
      } else if (filterType !== "ALL") {
        params.type = filterType;
      }

      const res = await getNotifications(params);
      setNotifications(res.notifications || []);
      setTotal(res.total || 0);
      setUnreadCount(res.unreadCount || 0);
    } catch (err) {
      setError(err.message || "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterType]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  async function handleMarkRead(id) {
    try {
      await markNotificationRead(id, { csrfToken: getCsrfToken() });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      setError(err.message || "Failed to mark notification as read.");
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead({ csrfToken: getCsrfToken() });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (err) {
      setError(err.message || "Failed to mark all as read.");
    }
  }

  async function handleDelete(id) {
    try {
      await deleteNotification(id, { csrfToken: getCsrfToken() });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      setError(err.message || "Failed to delete notification.");
    }
  }

  async function handleClearRead() {
    try {
      await clearReadNotifications({ csrfToken: getCsrfToken() });
      setNotifications((prev) => prev.filter((n) => !n.isRead));
      loadNotifications();
    } catch (err) {
      setError(err.message || "Failed to clear read notifications.");
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bell className="size-5" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Notifications
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Review activity alerts, approvals, and important notices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-accent transition-colors"
            >
              <CheckCheck className="size-3.5 text-primary" aria-hidden="true" />
              <span>Mark all read</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClearRead}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Clear read</span>
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-2xs text-xs">
        {[
          { key: "ALL", label: "All Notifications" },
          { key: "UNREAD", label: `Unread (${unreadCount})` },
          { key: "ANNOUNCEMENT", label: "Announcements" },
          { key: "ATTENDANCE", label: "Attendance" },
          { key: "PAYROLL", label: "Payroll" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setFilterType(tab.key);
              setPage(1);
            }}
            className={`cursor-pointer rounded-lg px-3 py-1.5 font-semibold transition-all ${
              filterType === tab.key
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error alert */}
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">
          {error}
        </div>
      )}

      {/* Notifications list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          <p className="mt-3 text-xs font-medium">Loading notifications…</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-16 text-center">
          <Bell className="mx-auto size-10 text-muted-foreground/40 stroke-1" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">No notifications found</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {filterType === "UNREAD"
              ? "You have marked all notifications as read."
              : "There are no notifications matching this filter."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`group flex items-start gap-4 p-4 transition-colors hover:bg-accent/40 ${
                !n.isRead ? "bg-primary/5" : ""
              }`}
            >
              <div className="mt-0.5 shrink-0 rounded-full bg-background p-2 border border-border/80 shadow-2xs">
                {getNotificationIcon(n.type)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3
                      className={`text-xs sm:text-sm font-semibold ${
                        !n.isRead ? "text-foreground font-bold" : "text-muted-foreground"
                      }`}
                    >
                      {n.title}
                    </h3>

                    {!n.isRead && (
                      <span className="size-2 rounded-full bg-primary" aria-label="Unread" />
                    )}
                  </div>

                  <span className="text-[11px] text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {n.message}
                </p>

                {n.link && (
                  <div className="mt-2.5">
                    <Link
                      to={n.link}
                      onClick={() => {
                        if (!n.isRead) handleMarkRead(n.id);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <span>Go to details</span>
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!n.isRead && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(n.id)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    title="Mark as read"
                  >
                    <Check className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(n.id)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between border-t border-border pt-4 text-xs">
          <p className="text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-border bg-background px-3 py-1 font-medium hover:bg-accent disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border bg-background px-3 py-1 font-medium hover:bg-accent disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

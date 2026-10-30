import { useState, useEffect } from "react";
import { Link } from "react-router";
import { Megaphone, Pin, AlertCircle, Check, ArrowRight } from "lucide-react";
import { getAnnouncements, markAnnouncementRead } from "@/services/announcement.service";
import { useAuth } from "@/context/auth-context";

export default function AnnouncementBanner() {
  const { getCsrfToken } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getAnnouncements({ pageSize: 5 })
      .then((data) => {
        if (active) {
          // Highlight pinned or urgent/high priority announcements first
          const urgentOrPinned = (data.announcements || []).filter(
            (a) => a.pinned || a.priority === "URGENT" || a.priority === "HIGH"
          );
          setAnnouncements(urgentOrPinned.slice(0, 2));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleAcknowledge(id) {
    try {
      await markAnnouncementRead(id, { csrfToken: getCsrfToken() });
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isRead: true } : a))
      );
    } catch {
      // Non-blocking
    }
  }

  if (loading || announcements.length === 0) return null;

  return (
    <div className="space-y-3">
      {announcements.map((a) => {
        const isUrgent = a.priority === "URGENT";

        return (
          <div
            key={a.id}
            className={`relative overflow-hidden rounded-xl border p-4 shadow-xs transition-all sm:p-5 ${
              isUrgent
                ? "border-destructive/30 bg-destructive/5 text-destructive-foreground"
                : a.pinned
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-card text-card-foreground"
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 shrink-0 rounded-lg p-2 ${
                    isUrgent
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {isUrgent ? (
                    <AlertCircle className="size-4" aria-hidden="true" />
                  ) : a.pinned ? (
                    <Pin className="size-4" aria-hidden="true" />
                  ) : (
                    <Megaphone className="size-4" aria-hidden="true" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Pin className="size-2.5" aria-hidden="true" />
                        Pinned
                      </span>
                    )}

                    {isUrgent && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                        URGENT
                      </span>
                    )}

                    <h3 className="text-sm font-semibold tracking-tight text-foreground">
                      {a.title}
                    </h3>
                  </div>

                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {a.content}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:self-center">
                {!a.isRead ? (
                  <button
                    type="button"
                    onClick={() => handleAcknowledge(a.id)}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Check className="size-3.5 text-primary" aria-hidden="true" />
                    <span>Acknowledge</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
                    Acknowledged
                  </span>
                )}

                <Link
                  to="/announcements"
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                >
                  <span>All</span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

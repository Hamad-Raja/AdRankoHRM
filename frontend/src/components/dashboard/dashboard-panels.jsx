import { Link } from "react-router";
import { Bell, Megaphone, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { announcementLabel, announcementPublished } from "./hr-announcements";
export function ResourceState({ resource, label, children }) {
  return resource.loading ? (
    <div role="status" className="hr-loading">
      <span className="hr-loading-dot" />
      Loading {label}…
    </div>
  ) : resource.error ? (
    <div className="hr-state" role="alert">
      <p>{label} unavailable</p>
      <p className="hr-muted">{resource.error.message}</p>
      <Button variant="outline" size="sm" onClick={resource.retry}>
        Retry {label}
      </Button>
    </div>
  ) : (
    children
  );
}
export function DashboardCard({
  title,
  icon: Icon,
  children,
  controls,
  className = "",
}) {
  return (
    <section aria-label={title} className={`hr-card ${className}`}>
      <header className="hr-card-heading">
        <h2>
          <Icon aria-hidden="true" />
          {title}
        </h2>
        {controls}
      </header>
      {children}
    </section>
  );
}
export function RecentAnnouncements({ resource, quietEmpty = false }) {
  const items = resource.data?.items.slice(0, 3) || [];
  return (
    <DashboardCard
      title="Recent Announcements"
      icon={Megaphone}
      controls={
        <Link className="hr-announcements-all" to="/announcements">
          View All<span className="sr-only"> announcements</span>
        </Link>
      }
      className="hr-announcements"
    >
      <ResourceState resource={resource} label="announcements">
        {items.length ? (
          <ul className="hr-announcement-list">
            {items.map((item) => (
              <li key={item.id}>
                <Megaphone aria-hidden="true" />
                <div>
                  <Link className="hr-announcement-title" to={item.link}>
                    {item.title}
                  </Link>
                  <div className="hr-announcement-meta">
                    <span>{announcementLabel(item.category)}</span>
                    <span>{announcementLabel(item.priority)}</span>
                    {item.pinned && (
                      <span>
                        <Pin aria-hidden="true" />
                        Pinned
                      </span>
                    )}
                  </div>
                  <time dateTime={item.publishedAt}>
                    {announcementPublished(item.publishedAt)} PKT
                  </time>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          quietEmpty ? (
            <div className="hr-announcements-empty">
              <Bell aria-hidden="true" />
              <p>No announcements yet</p>
            </div>
          ) : <p className="hr-announcements-empty">No announcements available.</p>
        )}
      </ResourceState>
    </DashboardCard>
  );
}

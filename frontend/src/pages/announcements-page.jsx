import { useState, useEffect, useCallback } from "react";
import {
  Megaphone,
  Pin,
  Plus,
  Search,
  Check,
  CheckCheck,
  Calendar,
  User,
  Users,
  Eye,
  Edit,
  Trash2,
  X,
  AlertCircle,
  Clock,
  Layers,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import {
  getAnnouncements,
  getManagementAnnouncements,
  markAnnouncementRead,
  markAllAnnouncementsRead,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAcknowledgements,
} from "@/services/announcement.service";
import { organization } from "@/services/organization.service";

const PRIORITY_BADGES = {
  LOW: {
    label: "Low",
    className: "bg-muted text-muted-foreground border-border",
  },
  NORMAL: {
    label: "Normal",
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  },
  HIGH: {
    label: "High",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  URGENT: {
    label: "Urgent",
    className: "bg-destructive/10 text-destructive border-destructive/20 font-bold",
  },
};

const STATUS_BADGES = {
  DRAFT: {
    label: "Draft",
    className: "bg-muted text-muted-foreground",
  },
  PUBLISHED: {
    label: "Published",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
};

export default function AnnouncementsPage() {
  const { user, getCsrfToken } = useAuth();
  const canManage = ["ADMIN", "HR"].includes(user.role);

  const [activeTab, setActiveTab] = useState("feed"); // 'feed' | 'manage'
  const [announcements, setAnnouncements] = useState([]);
  const [_total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Modals & form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    priority: "NORMAL",
    status: "PUBLISHED",
    targetRole: "",
    departmentId: "",
    pinned: false,
    expiresAt: "",
  });
  const [formError, setFormError] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Departments for targeting
  const [departments, setDepartments] = useState([]);

  // Acknowledgements modal
  const [acksModalOpen, setAcksModalOpen] = useState(false);
  const [acksData, setAcksData] = useState(null);
  const [acksLoading, setAcksLoading] = useState(false);

  // Fetch departments if manager/admin
  useEffect(() => {
    if (canManage) {
      organization()
        .then((data) => {
          const depts = (data.units || []).filter(
            (u) => u.kind === "DEPARTMENT" && !u.archivedAt
          );
          setDepartments(depts);
        })
        .catch(() => {});
    }
  }, [canManage]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (activeTab === "manage" && canManage) {
        const res = await getManagementAnnouncements({
          search: search || undefined,
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
        });
        setAnnouncements(res.announcements || []);
        setTotal(res.total || 0);
      } else {
        const res = await getAnnouncements({
          search: search || undefined,
          priority: priorityFilter || undefined,
          unreadOnly: unreadOnly || undefined,
        });
        setAnnouncements(res.announcements || []);
        setTotal(res.total || 0);
      }
    } catch (err) {
      setError(err.message || "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, canManage, search, priorityFilter, statusFilter, unreadOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleMarkRead(id) {
    try {
      await markAnnouncementRead(id, { csrfToken: getCsrfToken() });
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isRead: true, readAt: new Date().toISOString() } : a))
      );
    } catch (err) {
      setError(err.message || "Failed to mark announcement as read.");
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllAnnouncementsRead({ csrfToken: getCsrfToken() });
      setAnnouncements((prev) =>
        prev.map((a) => ({ ...a, isRead: true, readAt: new Date().toISOString() }))
      );
    } catch (err) {
      setError(err.message || "Failed to mark all as read.");
    }
  }

  function openCreateModal() {
    setEditingItem(null);
    setFormData({
      title: "",
      content: "",
      priority: "NORMAL",
      status: "PUBLISHED",
      targetRole: "",
      departmentId: "",
      pinned: false,
      expiresAt: "",
    });
    setFormError("");
    setIsFormOpen(true);
  }

  function openEditModal(item) {
    setEditingItem(item);
    setFormData({
      title: item.title,
      content: item.content,
      priority: item.priority || "NORMAL",
      status: item.status || "PUBLISHED",
      targetRole: item.targetRole || "",
      departmentId: item.departmentId || "",
      pinned: Boolean(item.pinned),
      expiresAt: item.expiresAt ? item.expiresAt.slice(0, 16) : "",
    });
    setFormError("");
    setIsFormOpen(true);
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    if (!formData.title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!formData.content.trim()) {
      setFormError("Content is required.");
      return;
    }

    setFormSubmitting(true);
    setFormError("");

    try {
      const payload = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        priority: formData.priority,
        status: formData.status,
        targetRole: formData.targetRole || null,
        departmentId: formData.departmentId || null,
        pinned: formData.pinned,
        expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : null,
      };

      const csrfToken = getCsrfToken();
      if (editingItem) {
        await updateAnnouncement(editingItem.id, payload, { csrfToken });
      } else {
        await createAnnouncement(payload, { csrfToken });
      }

      setIsFormOpen(false);
      loadData();
    } catch (err) {
      setFormError(err.message || "Failed to save announcement.");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Are you sure you want to delete this announcement? This action cannot be undone.")) {
      return;
    }

    try {
      await deleteAnnouncement(id, { csrfToken: getCsrfToken() });
      loadData();
    } catch (err) {
      setError(err.message || "Failed to delete announcement.");
    }
  }

  async function handleViewAcks(id) {
    setAcksModalOpen(true);
    setAcksLoading(true);
    setAcksData(null);
    try {
      const data = await getAcknowledgements(id);
      setAcksData(data);
    } catch (err) {
      setError(err.message || "Failed to load acknowledgements.");
    } finally {
      setAcksLoading(false);
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Megaphone className="size-5" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Announcements
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Stay informed with company announcements, policy updates, and team news.
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-all"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>New Announcement</span>
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      {canManage && (
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setActiveTab("feed")}
            className={`cursor-pointer px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "feed"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            All Announcements
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("manage")}
            className={`cursor-pointer px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "manage"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Manage & Publishing
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-2xs">
        <div className="flex flex-wrap flex-1 items-center gap-2 sm:gap-3">
          {/* Search */}
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search announcements…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background pl-8.5 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All Priorities</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </select>

          {/* Status filter (only for manage view) */}
          {activeTab === "manage" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value="">All Statuses</option>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          )}

          {/* Unread only filter (only for feed view) */}
          {activeTab === "feed" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground select-none">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="size-4 rounded border-border text-primary focus:ring-ring"
              />
              <span>Unread only</span>
            </label>
          )}
        </div>

        {activeTab === "feed" && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-accent transition-colors"
          >
            <CheckCheck className="size-3.5 text-primary" aria-hidden="true" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* Error alert */}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Content Feed */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          <p className="mt-3 text-xs font-medium">Loading announcements…</p>
        </div>
      ) : announcements.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-16 text-center">
          <Megaphone className="mx-auto size-10 text-muted-foreground/40 stroke-1" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">No announcements found</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {search || priorityFilter || unreadOnly
              ? "Try adjusting your filters or search terms."
              : "There are no company announcements published yet."}
          </p>
        </div>
      ) : activeTab === "manage" ? (
        /* Management View (Table) */
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Published</th>
                  <th className="px-4 py-3">Reads</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {announcements.map((a) => (
                  <tr key={a.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <div className="flex items-center gap-1.5">
                        {a.pinned && (
                          <span title="Pinned announcement" className="text-primary">
                            <Pin className="size-3.5" aria-hidden="true" />
                          </span>
                        )}
                        <span className="line-clamp-1 max-w-xs">{a.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGES[a.status]?.className}`}>
                        {STATUS_BADGES[a.status]?.label || a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_BADGES[a.priority]?.className}`}>
                        {PRIORITY_BADGES[a.priority]?.label || a.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.targetRole
                        ? `Role: ${a.targetRole}`
                        : a.departmentName
                        ? `Dept: ${a.departmentName}`
                        : "Everyone"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleViewAcks(a.id)}
                        className="inline-flex cursor-pointer items-center gap-1 font-semibold text-primary hover:underline"
                        title="View acknowledgements"
                      >
                        <Eye className="size-3" aria-hidden="true" />
                        <span>{a.readCount ?? 0}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(a)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Edit"
                        >
                          <Edit className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(a.id)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Feed View (Cards) */
        <div className="grid gap-4">
          {announcements.map((a) => {
            const isUrgent = a.priority === "URGENT";

            return (
              <article
                key={a.id}
                className={`relative rounded-2xl border p-5 shadow-xs transition-all ${
                  a.pinned
                    ? "border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card"
                    : isUrgent
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border bg-card hover:border-border/80"
                }`}
              >
                {/* Top metadata */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow-2xs">
                        <Pin className="size-2.5" aria-hidden="true" />
                        PINNED
                      </span>
                    )}

                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                        PRIORITY_BADGES[a.priority]?.className
                      }`}
                    >
                      {PRIORITY_BADGES[a.priority]?.label || a.priority}
                    </span>

                    {a.targetRole && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                        <Users className="size-2.5" aria-hidden="true" />
                        {a.targetRole}
                      </span>
                    )}

                    {a.departmentName && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                        <Layers className="size-2.5" aria-hidden="true" />
                        {a.departmentName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {a.author && (
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3" aria-hidden="true" />
                        {a.author.displayName}
                      </span>
                    )}

                    {a.publishedAt && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3" aria-hidden="true" />
                        {new Date(a.publishedAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="mt-3.5">
                  <h2 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                    {a.title}
                  </h2>

                  <div className="mt-2.5 whitespace-pre-wrap break-words text-xs sm:text-sm leading-relaxed text-foreground/90 font-normal">
                    {a.content}
                  </div>
                </div>

                {/* Footer action */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                  <div className="text-[11px] text-muted-foreground">
                    {a.expiresAt && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Clock className="size-3" aria-hidden="true" />
                        Expires {new Date(a.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <div>
                    {!a.isRead ? (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(a.id)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring transition-colors"
                      >
                        <Check className="size-3.5 text-primary" aria-hidden="true" />
                        <span>Acknowledge</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="size-4" aria-hidden="true" />
                        <span>Acknowledged</span>
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-bold text-foreground">
                {editingItem ? "Edit Announcement" : "Create Announcement"}
              </h2>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                {formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="mt-4 space-y-4 text-xs">
              <div>
                <label htmlFor="form-title" className="block font-semibold text-foreground">Title *</label>
                <input
                  id="form-title"
                  type="text"
                  required
                  maxLength={200}
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. Office Closure for Annual Maintenance"
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                />
              </div>

              <div>
                <label htmlFor="form-content" className="block font-semibold text-foreground">Content *</label>
                <textarea
                  id="form-content"
                  required
                  rows={5}
                  maxLength={20000}
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Write full announcement details..."
                  className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-priority" className="block font-semibold text-foreground">Priority</label>
                  <select
                    id="form-priority"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="form-status" className="block font-semibold text-foreground">Status</label>
                  <select
                    id="form-status"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <option value="PUBLISHED">Published (Notify users)</option>
                    <option value="DRAFT">Draft</option>
                    {editingItem && <option value="ARCHIVED">Archived</option>}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="form-target-role" className="block font-semibold text-foreground">Target Role (Optional)</label>
                  <select
                    id="form-target-role"
                    value={formData.targetRole}
                    onChange={(e) => setFormData({ ...formData, targetRole: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <option value="">All Roles</option>
                    <option value="ADMIN">Admin Only</option>
                    <option value="HR">HR Only</option>
                    <option value="MANAGER">Manager Only</option>
                    <option value="EMPLOYEE">Employee Only</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="form-target-dept" className="block font-semibold text-foreground">Target Department (Optional)</label>
                  <select
                    id="form-target-dept"
                    value={formData.departmentId}
                    onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <option value="">All Departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-center pt-1">
                <div>
                  <label htmlFor="form-expires-at" className="block font-semibold text-foreground">Expiration Date (Optional)</label>
                  <input
                    id="form-expires-at"
                    type="datetime-local"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  />
                </div>

                <div className="pt-5">
                  <label htmlFor="form-pinned" className="flex cursor-pointer items-center gap-2 select-none">
                    <input
                      id="form-pinned"
                      type="checkbox"
                      checked={formData.pinned}
                      onChange={(e) => setFormData({ ...formData, pinned: e.target.checked })}
                      className="size-4 rounded border-border text-primary focus:ring-ring"
                    />
                    <span className="font-semibold text-foreground">Pin to top of feed</span>
                  </label>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="rounded-lg border border-border bg-background px-4 py-2 font-semibold text-foreground hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-2xs hover:bg-primary/90 disabled:opacity-50"
                >
                  {formSubmitting ? "Saving..." : editingItem ? "Update" : "Publish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Acknowledgements Audit Modal */}
      {acksModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Acknowledgements & Reads</h2>
                {acksData && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                    {acksData.title}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAcksModalOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 max-h-[360px] overflow-y-auto">
              {acksLoading ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  <div className="inline-block size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="mt-2">Loading acknowledgements…</p>
                </div>
              ) : !acksData || acksData.acknowledgements.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No one has acknowledged this announcement yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  <p className="pb-2 text-xs font-semibold text-primary">
                    Total acknowledgements: {acksData.totalReads}
                  </p>
                  {acksData.acknowledgements.map((ack, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2.5 text-xs">
                      <div>
                        <p className="font-semibold text-foreground">
                          {ack.displayName}{" "}
                          {ack.employeeCode && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              ({ack.employeeCode})
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {ack.role} · {ack.email}
                        </p>
                      </div>

                      <div className="text-right text-[11px] text-muted-foreground">
                        {new Date(ack.readAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setAcksModalOpen(false)}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

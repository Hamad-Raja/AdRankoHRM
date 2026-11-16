import { useState } from "react";
import { LoaderCircle, LogOut, Menu } from "lucide-react";
import { Link, useLocation } from "react-router";

import { ThemeToggle } from "@/components/theme-toggle";
import NotificationBell from "@/components/notification-bell";
import { useAuth } from "@/context/auth-context";

const PAGE_TITLES = {
  "/dashboard": "Dashboard",
  "/account": "My profile",
  "/attendance": "Attendance",
  "/reports": "Reports",
  "/payroll": "Payroll Management",
  "/my-payslips": "My payslips",
  "/employees": "Employees",
  "/my-profile": "My profile",
  "/employment": "Employment",
  "/audit": "Global Audit Log",
  "/employees/new": "Add employee",
  "/organization": "Organization",
  "/attendance-settings": "Attendance Settings",
  "/my-employees": "Employee profiles",
  "/announcements": "Announcements",
  "/notifications": "Notifications",
  "/leaves": "Leave",
};

const ROLE_LABELS = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

function getInitials(displayName) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  const selectedParts =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;

  return (
    selectedParts
      .map((part) => Array.from(part)[0] || "")
      .join("")
      .toLocaleUpperCase() || "OH"
  );
}

export default function PortalHeader({
  onOpenMenu,
  menuOpen,
  menuId,
}) {
  const { user, logout, pendingAction } = useAuth();
  const location = useLocation();

  const [logoutError, setLogoutError] = useState("");

  const pageTitle =
    (user.role==='ADMIN' ? {'/leaves':'Leave Overview','/employment':'Employment Management','/my-profile':'Account & Security','/account':'Account & Security'}[location.pathname] : null) ||
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith("/employees/")
      ? "Employee details"
      : "OfficeHR");
  const busy = pendingAction !== null;

  async function handleLogout() {
    if (busy) return;

    setLogoutError("");

    try {
      await logout();
    } catch (error) {
      setLogoutError(
        error.message || "Unable to sign out. Please try again."
      );
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xs text-card-foreground shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-background/80 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
          >
            <Menu className="size-4" aria-hidden="true" />
          </button>

          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            {pageTitle}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <NotificationBell key={user.id} />
          <ThemeToggle />

          <Link
            to="/my-profile?tab=security"
            aria-label={`Open account and security for ${user.displayName}`}
            className="flex h-9 items-center gap-2.5 rounded-lg px-2 hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-colors"
          >
            <span
              aria-hidden="true"
              className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-xs font-bold text-primary shadow-2xs"
            >
              {getInitials(user.displayName)}
            </span>

            <span className="hidden min-w-0 text-left md:block">
              <span className="block max-w-36 truncate text-xs font-semibold leading-tight text-foreground">
                {user.displayName}
              </span>

              <span className="block text-[11px] leading-tight text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </span>
            </span>
          </Link>

          <button
            type="button"
            disabled={busy}
            onClick={handleLogout}
            aria-label={
              pendingAction === "logout" ? "Signing out" : "Sign out"
            }
            title="Sign out"
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border/80 bg-background/80 px-3 text-xs font-semibold text-foreground shadow-2xs hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-all disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingAction === "logout" ? (
              <LoaderCircle
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <LogOut className="size-3.5" aria-hidden="true" />
            )}

            <span className="hidden lg:inline">
              {pendingAction === "logout" ? "Signing out..." : "Sign out"}
            </span>
          </button>
        </div>
      </div>

      {logoutError && (
        <p
          role="alert"
          className="border-t border-destructive/20 bg-destructive/10 px-4 py-2.5 text-xs font-medium text-destructive sm:px-6 lg:px-8"
        >
          {logoutError}
        </p>
      )}
    </header>
  );
}

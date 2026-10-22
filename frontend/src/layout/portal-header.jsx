import { useState } from "react";
import { LoaderCircle, LogOut, Menu } from "lucide-react";
import { Link, useLocation } from "react-router";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/context/auth-context";

const PAGE_TITLES = {
  "/dashboard": "Dashboard",
  "/account": "My account",
  "/employees": "Employees",
  "/employees/new": "Add employee",
  "/organization": "Organization",
  "/my-employees": "Employee profiles",
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

  const pageTitle = PAGE_TITLES[location.pathname] || (location.pathname.startsWith('/employees/') ? 'Employee details' : 'OfficeHR');
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
    <header className="sticky top-0 z-30 border-b border-border bg-card text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>

          <p className="truncate text-sm font-semibold">
            {pageTitle}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle className="gap-1 px-2 sm:gap-2 sm:px-3" />

          <Link
            to="/account"
            aria-label={`Open account for ${user.displayName}`}
            className="flex min-h-11 items-center gap-3 rounded-md px-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-2"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
            >
              {getInitials(user.displayName)}
            </span>

            <span className="hidden min-w-0 text-left md:block">
              <span className="block max-w-36 truncate text-sm font-medium">
                {user.displayName}
              </span>

              <span className="block text-xs text-muted-foreground">
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
            className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingAction === "logout" ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <LogOut className="size-4" aria-hidden="true" />
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
          className="border-t border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:px-6 lg:px-8"
        >
          {logoutError}
        </p>
      )}
    </header>
  );
}

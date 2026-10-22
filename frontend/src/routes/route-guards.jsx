import { LoaderCircle } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/context/auth-context";

function SessionStatusScreen() {
  const { status, error, refreshSession } = useAuth();
  const loading = status === "loading";

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex justify-end p-5">
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-12">
        <section className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <div className="text-2xl font-bold tracking-tight">
            Office<span className="text-primary">HR</span>
          </div>

          {loading ? (
            <div
              role="status"
              className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              Checking your session...
            </div>
          ) : (
            <>
              <h1 className="mt-6 text-xl font-semibold">
                Unable to verify your session
              </h1>

              <p role="alert" className="mt-3 text-sm text-muted-foreground">
                {error || "Please try again."}
              </p>

              <button
                type="button"
                onClick={() => void refreshSession()}
                className="mt-6 min-h-11 cursor-pointer rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Try again
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export function ProtectedRoute({
  allowedRoles,
  allowPasswordChange = false,
}) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "unauthenticated") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  if (status !== "authenticated") {
    return <SessionStatusScreen />;
  }

  if (user.mustChangePassword && !allowPasswordChange) {
    return <Navigate to="/account" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <section className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm font-semibold text-muted-foreground">403</p>

          <h1 className="mt-3 text-2xl font-semibold">
            Access restricted
          </h1>

          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            You do not have permission to open this page.
          </p>

          <Link
            to="/dashboard"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Back to dashboard
          </Link>
        </section>
      </main>
    );
  }

  return <Outlet />;
}

export function GuestRoute({ children }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "authenticated") {
    if (user.mustChangePassword) {
      return <Navigate to="/account" replace />;
    }

    const requestedPath = location.state?.from;

    const canReturn = typeof requestedPath === "string" && (
      ["/dashboard", "/account"].includes(requestedPath) ||
      (["ADMIN", "HR"].includes(user.role) && /^\/(employees(?:\/new|\/[0-9a-f-]{36})?|organization)$/.test(requestedPath)) ||
      (["MANAGER", "EMPLOYEE"].includes(user.role) && requestedPath === "/my-employees")
    );
    const destination = canReturn
      ? requestedPath
      : "/dashboard";

    return <Navigate to={destination} replace />;
  }

  if (status !== "unauthenticated") {
    return <SessionStatusScreen />;
  }

  return children;
}

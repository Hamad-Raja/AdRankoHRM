import { Link } from "react-router";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/context/auth-context";

export default function NotFoundPage() {
  const { status, user } = useAuth();

  const destination =
    status === "authenticated"
      ? user.mustChangePassword
        ? "/account"
        : "/dashboard"
      : "/login";

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex justify-end p-5">
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-12">
        <section className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-primary">404</p>

          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl tracking-tight leading-tight">
            Page not found
          </h1>

          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This page does not exist or its address has changed.
          </p>

          <Link
            to={destination}
            className="mt-6 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-colors"
          >
            {status === "authenticated" ? "Return to AdRankoHRM" : "Go to sign in"}
          </Link>
        </section>
      </main>
    </div>
  );
}
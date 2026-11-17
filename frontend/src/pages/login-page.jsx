import { useEffect, useRef, useState } from "react";
import { useNavigate } from 'react-router';
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/context/auth-context";
import { DEMO_LOGIN_ENABLED, DEMO_LOGIN_LABEL } from '@/services/auth.service';

const INPUT_CLASSES =
  "mt-2 h-10 w-full rounded-lg border border-input bg-background/80 px-3.5 " +
  "text-sm text-foreground shadow-2xs transition-colors focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function LoginPage() {
  const { login, demoLogin, notice, pendingAction } = useAuth();
  const navigate = useNavigate();
  const requestRef = useRef(null);
  const [selectedRole, setSelectedRole] = useState(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const busy = pendingAction !== null;

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;

    setError("");

    try {
      await login({
        email: email.trim(),
        password,
      }, { signal: controller.signal });
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(
        requestError.details?.[0]?.message ||
        requestError.message ||
        "Unable to sign in. Please try again."
      );

      setPassword("");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function handleDemo(role) {
    if (busy || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setSelectedRole(role);
    setError('');
    // Demo logins always start on the dashboard; regular login retains return links.
    navigate('/login', { replace: true, state: { from: '/dashboard' } });
    try {
      await demoLogin(role, { signal: controller.signal });
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError.message || 'Unable to sign in. Please try again.');
    } finally {
      if (!controller.signal.aborted) setSelectedRole(null);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="text-3xl font-bold tracking-tight">
          AdRanko<span className="text-sidebar-ring">HRM</span>
        </div>

        <div className="max-w-md">
          <p className="text-sm font-semibold text-sidebar-ring">
            Welcome to AdRankoHRM
          </p>

          <h1 className="mt-4 text-2xl font-semibold leading-tight">
           Manage Your Workday with Ease.
          </h1>

          <p className="mt-5 leading-7 text-sidebar-foreground/80 ">
           Manage attendance, payroll, and workplace updates with ease.
          </p>
        </div>

        <p className="text-sm text-sidebar-foreground/70">
          AdRankoHRM · People. Work. Connected.
        </p>
      </aside>

      <div className="flex min-h-svh flex-col">
        <header className="flex items-center justify-between gap-4 p-5 sm:p-8">
          <div className="text-xl font-bold tracking-tight lg:invisible">
            AdRanko<span className="text-primary">HRM</span>
          </div>

          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-8">
          <section
            aria-labelledby="login-heading"
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
          >
            <h2
              id="login-heading"
              className="text-2xl font-semibold tracking-tight text-card-foreground"
            >
              Sign in
            </h2>

            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use the account provided by your administrator.
            </p>

            {notice && (
              <p
                role="status"
                className="mt-5 rounded-md bg-accent p-3 text-sm text-accent-foreground"
              >
                {notice}
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-6">
              <fieldset disabled={busy} className="space-y-5">
                <legend className="sr-only">Sign-in details</legend>

                <div>
                  <label htmlFor="login-email" className="text-sm font-medium">
                    Email address
                  </label>

                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={INPUT_CLASSES}
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="text-sm font-medium">
                    Password
                  </label>

                  <div className="relative">
                    <input
                      id="login-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={`${INPUT_CLASSES} pr-12`}
                    />

                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((previous) => !previous)}
                      className="absolute right-1 bottom-1 flex size-9 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
                >
                  {busy && (
                    <LoaderCircle
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}

                  {busy ? "Signing in..." : "Sign in"}
                </button>
              </fieldset>
            </form>

            {DEMO_LOGIN_ENABLED && (
              <section aria-labelledby="demo-heading" className="mt-6 border-t border-border pt-5">
                <h3 id="demo-heading" className="text-sm font-semibold">{DEMO_LOGIN_LABEL}</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {['HR', 'Manager', 'Employee'].map(label => {
                    const role = label.toUpperCase();
                    return <button key={role} type="button" disabled={busy}
                      aria-label={`Login as ${label}`} aria-busy={busy && selectedRole === role}
                      onClick={() => void handleDemo(role)}
                      className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
                      {busy && selectedRole === role && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                      {busy && selectedRole === role ? 'Signing in...' : `Login as ${label}`}
                    </button>;
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Synthetic accounts only. Sign out before switching roles.</p>
              </section>
            )}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Need access? Contact your HR administrator.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

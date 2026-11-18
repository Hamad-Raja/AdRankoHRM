import { useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { Navigate, useLocation } from "react-router";

import { useAuth } from "@/context/auth-context";
import { Badge } from "@/components/ui/badge";

export const ROLE_LABELS = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

const INPUT_CLASSES =
  "mt-2 h-9 w-full rounded-lg border border-input bg-background/80 px-3 " +
  "text-sm text-foreground shadow-2xs transition-colors focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-ring";

const BUTTON_CLASSES =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-2 " +
  "rounded-lg px-4 text-xs font-semibold shadow-2xs transition-colors focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const PASSWORD_FIELDS = [
  {
    name: "currentPassword",
    label: "Current password",
    autoComplete: "current-password",
  },
  {
    name: "newPassword",
    label: "New password",
    autoComplete: "new-password",
  },
  {
    name: "confirmPassword",
    label: "Confirm new password",
    autoComplete: "new-password",
  },
];

function PasswordChangeForm({ canCancel, onCancel }) {
  const { changePassword, pendingAction } = useAuth();

  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [error, setError] = useState("");
  const busy = pendingAction !== null;

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy) return;

    setError("");

    if (passwords.newPassword !== passwords.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (Array.from(passwords.newPassword).length < 8) {
      setError("New password must contain at least 8 characters.");
      return;
    }

    if (new TextEncoder().encode(passwords.newPassword).length > 72) {
      setError("New password is too long. Use a shorter password.");
      return;
    }

    if (passwords.newPassword === passwords.currentPassword) {
      setError("Choose a password different from your current password.");
      return;
    }

    try {
      await changePassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
    } catch (requestError) {
      setError(
        requestError.details?.[0]?.message ||
          requestError.message ||
          "Unable to change your password."
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6">
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <fieldset disabled={busy} className="space-y-5">
        <legend className="sr-only">Change your password</legend>

        {PASSWORD_FIELDS.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`account-${field.name}`}
              className="text-sm font-medium"
            >
              {field.label}
            </label>

            <input
              id={`account-${field.name}`}
              name={field.name}
              type="password"
              autoComplete={field.autoComplete}
              required
              value={passwords[field.name]}
              onChange={(event) =>
                setPasswords((previous) => ({
                  ...previous,
                  [field.name]: event.target.value,
                }))
              }
              className={INPUT_CLASSES}
            />
          </div>
        ))}

        <p className="text-sm leading-6 text-muted-foreground">
          Use at least 8 characters and at most 72 UTF-8 bytes. Changing your password signs you out
          on all devices.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className={`${BUTTON_CLASSES} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            {pendingAction === "password" && (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            )}

            {pendingAction === "password" ? "Updating..." : "Update password"}
          </button>

          {canCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={`${BUTTON_CLASSES} border border-border bg-card hover:bg-accent`}
            >
              Cancel
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function AccountStatusBadge({ status }) {
  const label = status === 'ACTIVE' ? 'Active' : status === 'DISABLED' ? 'Disabled' : 'Not recorded';
  return <Badge variant="outline" className={status === 'ACTIVE' ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}>{label}</Badge>;
}

export function AccountSecurityContent() {
  const { user, pendingAction } = useAuth();

  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const busy = pendingAction !== null;
  const passwordChangeRequired = user.mustChangePassword;

  return (
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <section
          aria-labelledby="account-details-heading"
          className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6"
        >
          <h2 id="account-details-heading" className="flex items-center gap-3 text-lg font-semibold">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound aria-hidden="true" className="size-5" /></span>
            Account details
          </h2>

          <dl className="mt-4 divide-y divide-border">
            {[
              ["Name", user.displayName],
              ["Email", user.email],
              ["Role", ROLE_LABELS[user.role]],
              ["Account status", <AccountStatusBadge key="status" status={user.status} />],
            ].map(([label, value]) => (
              <div key={label} className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] sm:gap-4">
                <dt className="text-sm font-medium text-foreground/80">
                  {label}
                </dt>

                <dd className="min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="account-security-heading"
          className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6"
        >
          <h2 id="account-security-heading" className="flex items-center gap-3 text-lg font-semibold">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck aria-hidden="true" className="size-5" /></span>
            Password and security
          </h2>

          {['EMPLOYEE','MANAGER'].includes(user.role) ? <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-sm font-medium">Contact Admin or HR to reset your password.</p>{passwordChangeRequired && <p className="mt-2 text-sm text-muted-foreground">An administrator must update your credentials before you can continue.</p>}</div> : <>
          {passwordChangeRequired && (
            <p
              role="status"
              className="mt-4 rounded-md bg-warning p-3 text-sm text-warning-foreground"
            >
              Please change your password before continuing.
            </p>
          )}

          {passwordChangeRequired || showPasswordForm ? (
            <PasswordChangeForm
              canCancel={!passwordChangeRequired}
              onCancel={() => setShowPasswordForm(false)}
            />
          ) : (
            <>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Keep your account protected with a password you do not
                use elsewhere.
              </p>

              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPasswordForm(true)}
                className={`${BUTTON_CLASSES} mt-5 bg-primary text-primary-foreground hover:bg-primary/90`}
              >
                <KeyRound aria-hidden="true" className="size-4" />
                Change my password
              </button>
            </>
          )}</>}
        </section>
      </div>
  );
}

export default function AccountPage() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set('tab', 'security');
  return <Navigate to={{ pathname: '/my-profile', search: `?${search}`, hash: location.hash }} state={location.state} replace />;
}

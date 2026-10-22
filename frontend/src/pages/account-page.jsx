import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { useAuth } from "@/context/auth-context";

const ROLE_LABELS = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

const INPUT_CLASSES =
  "mt-2 h-11 w-full rounded-md border border-input bg-background px-3 " +
  "text-sm text-foreground focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-ring";

const BUTTON_CLASSES =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 " +
  "rounded-md px-4 text-sm font-medium focus-visible:outline-2 " +
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

export default function AccountPage() {
  const { user, pendingAction } = useAuth();

  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const busy = pendingAction !== null;
  const passwordChangeRequired = user.mustChangePassword;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          My account
        </h1>

        <p className="mt-3 text-muted-foreground">
          Manage your account details and security.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <section
          aria-labelledby="account-details-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-6 shadow-sm"
        >
          <h2 id="account-details-heading" className="text-lg font-semibold">
            Account details
          </h2>

          <dl className="mt-5 space-y-5">
            {[
              ["Name", user.displayName],
              ["Email", user.email],
              ["Role", ROLE_LABELS[user.role]],
              ["Status", "Active"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">
                  {label}
                </dt>

                <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="account-security-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-6 shadow-sm"
        >
          <h2 id="account-security-heading" className="text-lg font-semibold">
            Password and security
          </h2>

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
                className={`${BUTTON_CLASSES} mt-5 border border-border bg-card hover:bg-accent`}
              >
                Change password
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

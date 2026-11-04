import { useId, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";

const PROFILE_FIELDS = [
  {
    name: "fullName",
    label: "Full name",
    maxLength: 120,
    required: true,
  },
  {
    name: "personalEmail",
    label: "Personal email",
    type: "email",
    maxLength: 254,
    hint: "Optional contact email. Portal login is configured below.",
  },
  {
    name: "phone",
    label: "Phone number",
    type: "tel",
    maxLength: 32,
  },
  {
    name: "address",
    label: "Address",
    maxLength: 1000,
    multiline: true,
    wide: true,
  },
  {
    name: "emergencyContactName",
    label: "Emergency contact name",
    maxLength: 120,
  },
  {
    name: "emergencyContactPhone",
    label: "Emergency contact phone",
    type: "tel",
    maxLength: 32,
  },
  {
    name: "emergencyContactRelationship",
    label: "Emergency contact relationship",
    maxLength: 60,
  },
];

const CONTROL_CLASS =
  "min-h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

function Field({
  id,
  label,
  hint,
  multiline = false,
  wide = false,
  error,
  ...props
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  const describedBy =
    [hintId, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div
      className={
        wide
          ? "min-w-0 space-y-2 sm:col-span-2"
          : "min-w-0 space-y-2"
      }
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {props.required && (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {multiline ? (
        <textarea
          {...props}
          id={id}
          rows={3}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          className={`${CONTROL_CLASS} resize-y`}
        />
      ) : (
        <Input
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          className="min-h-10"
        />
      )}

      {hint && (
        <p
          id={hintId}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      )}

      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export default function EmployeeForm({
  employee = null,
  onSubmit,
  busy = false,
  blocked = false,
  issues = [],
}) {
  const prefix = useId();
  const { user } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");

  const editing = employee !== null;
  const disabled = busy || blocked;

  const [values, setValues] = useState(() => ({
    employeeCode: employee?.employeeCode ?? "",

    ...Object.fromEntries(
      PROFILE_FIELDS.map(({ name }) => [
        name,
        employee?.[name] ?? "",
      ])
    ),

    startDate: "",
    status: "",
    probationEndDate: "",
    confirmedOn: "",
    loginEmail: "",
    loginRole: "EMPLOYEE",
    password: "",
    confirmPassword: "",
  }));

  function handleChange(event) {
    const { name, value } = event.target;

    setValues((previous) => ({
      ...previous,
      [name]: value,
      ...(name === "status" && value === "PROBATION"
        ? { confirmedOn: "" }
        : {}),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    const profile = Object.fromEntries(
      PROFILE_FIELDS.map(({ name }) => {
        const value = values[name].trim();

        return [
          name,
          name === "fullName" ? value : value || null,
        ];
      })
    );

    if (editing) {
      void onSubmit({
        version: employee.version,
        ...profile,
      });

      return;
    }

    setLoginError("");

    if (values.password !== values.confirmPassword) {
      setLoginError("Passwords do not match.");
      return;
    }

    if (
      Array.from(values.password).length < 8 ||
      new TextEncoder().encode(values.password).length > 72
    ) {
      setLoginError(
        "Password must contain at least 8 characters and no more than 72 UTF-8 bytes."
      );
      return;
    }

    void onSubmit({
      portalLogin: {
        email: values.loginEmail.trim().toLowerCase(),
        password: values.password,
        role:
          user.role === "ADMIN"
            ? values.loginRole
            : "EMPLOYEE",
      },

      employeeCode: values.employeeCode.trim().toUpperCase(),
      ...profile,

      employment: {
        startDate: values.startDate,
        status: values.status,
        probationEndDate: values.probationEndDate || null,
        confirmedOn:
          values.status === "PROBATION"
            ? null
            : values.confirmedOn || null,

        reason:
          "Initial employment record created through Add Employee.",
      },
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      aria-busy={busy}
      className="space-y-6"
    >
      <fieldset
        disabled={disabled}
        className="min-w-0 space-y-6"
      >
        <legend className="sr-only">
          {editing
            ? "Edit employee profile"
            : "Create employee & login"}
        </legend>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Employee profile</h2>
            </CardTitle>

            <p className="text-sm text-muted-foreground">
              Fields marked with * are required.
            </p>
          </CardHeader>

          <CardContent className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field
              id={`${prefix}-employeeCode`}
              name="employeeCode"
              label="Employee code"
              value={values.employeeCode}
              onChange={handleChange}
              maxLength={30}
              required
              readOnly={editing}
              error={
                issues.find(
                  (issue) => issue.field === "employeeCode"
                )?.message
              }
              disabled={disabled}
              hint="A permanent unique code. Letters, numbers, hyphens and underscores are supported."
            />

            {PROFILE_FIELDS.map((field) => (
              <Field
                key={field.name}
                {...field}
                id={`${prefix}-${field.name}`}
                value={values[field.name]}
                onChange={handleChange}
                disabled={disabled}
                error={
                  issues.find(
                    (issue) => issue.field === field.name
                  )?.message
                }
              />
            ))}
          </CardContent>
        </Card>

        {!editing && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Initial employment</h2>
              </CardTitle>

              <p className="text-sm text-muted-foreground">
                Enter the approved joining details. No probation
                duration is assumed.
              </p>
            </CardHeader>

            <CardContent className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id={`${prefix}-startDate`}
                name="startDate"
                label="Joining date"
                type="date"
                value={values.startDate}
                onChange={handleChange}
                min="0001-01-01"
                max="9999-12-31"
                required
                disabled={disabled}
              />

              <div className="min-w-0 space-y-2">
                <label
                  htmlFor={`${prefix}-status`}
                  className="block text-sm font-medium"
                >
                  Initial status
                  <span
                    className="ml-1 text-destructive"
                    aria-hidden="true"
                  >
                    *
                  </span>
                </label>

                <select
                  id={`${prefix}-status`}
                  name="status"
                  value={values.status}
                  onChange={handleChange}
                  required
                  disabled={disabled}
                  className={CONTROL_CLASS}
                >
                  <option value="">Select status</option>
                  <option value="PROBATION">Probation</option>
                  <option value="ACTIVE">Active</option>
                </select>
              </div>

              <Field
                id={`${prefix}-probationEndDate`}
                name="probationEndDate"
                label="Probation end date"
                type="date"
                value={values.probationEndDate}
                onChange={handleChange}
                min={values.startDate || "0001-01-01"}
                max="9999-12-31"
                disabled={disabled}
                hint="Optional. Enter only when an approved date exists."
              />

              <Field
                id={`${prefix}-confirmedOn`}
                name="confirmedOn"
                label="Confirmation date"
                type="date"
                value={values.confirmedOn}
                onChange={handleChange}
                min={values.startDate || "0001-01-01"}
                max="9999-12-31"
                disabled={
                  disabled || values.status !== "ACTIVE"
                }
                hint="Optional for Active employees. Unavailable during probation."
              />
            </CardContent>
          </Card>
        )}

        {!editing && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle>
                <h2>Portal login</h2>
              </CardTitle>

              <p className="text-sm text-muted-foreground">
                Create the linked account for this employee&apos;s
                dashboard.
              </p>
            </CardHeader>

            <CardContent className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id={`${prefix}-loginEmail`}
                name="loginEmail"
                label="Login email"
                type="email"
                maxLength={254}
                required
                value={values.loginEmail}
                onChange={handleChange}
                disabled={disabled}
                error={
                  issues.find(
                    (issue) =>
                      issue.field === "portalLogin.email"
                  )?.message
                }
                hint="Use an existing personal or company email. This does not create an email mailbox."
              />

              <div className="space-y-2">
                <label
                  htmlFor={`${prefix}-loginRole`}
                  className="block text-sm font-medium"
                >
                  Portal role *
                </label>

                <select
                  id={`${prefix}-loginRole`}
                  name="loginRole"
                  value={values.loginRole}
                  onChange={handleChange}
                  disabled={
                    disabled || user.role !== "ADMIN"
                  }
                  className={CONTROL_CLASS}
                >
                  <option value="EMPLOYEE">Employee</option>

                  {user.role === "ADMIN" && (
                    <option value="MANAGER">Manager</option>
                  )}
                </select>

                <p className="text-xs text-muted-foreground">
                  Only Admin can create Manager accounts.
                </p>
              </div>

              <Field
                id={`${prefix}-password`}
                name="password"
                label="Password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={values.password}
                onChange={handleChange}
                disabled={disabled}
                error={
                  issues.find(
                    (issue) =>
                      issue.field === "portalLogin.password"
                  )?.message
                }
                hint="At least 8 characters; maximum 72 UTF-8 bytes."
              />

              <Field
                id={`${prefix}-confirmPassword`}
                name="confirmPassword"
                label="Confirm password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={values.confirmPassword}
                onChange={handleChange}
                disabled={disabled}
              />

              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    setShowPassword((value) => !value)
                  }
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}

                  {showPassword
                    ? "Hide passwords"
                    : "Show passwords"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    const alphabet =
                      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

                    const limit =
                      Math.floor(256 / alphabet.length) *
                      alphabet.length;

                    let password = "";

                    while (password.length < 16) {
                      const bytes = crypto.getRandomValues(
                        new Uint8Array(32)
                      );

                      for (const byte of bytes) {
                        if (
                          byte < limit &&
                          password.length < 16
                        ) {
                          password +=
                            alphabet[byte % alphabet.length];
                        }
                      }
                    }

                    setValues((previous) => ({
                      ...previous,
                      password,
                      confirmPassword: password,
                    }));

                    setLoginError("");
                  }}
                >
                  Generate password
                </Button>
              </div>

              <p className="text-sm text-muted-foreground sm:col-span-2">
                The employee must change this password on first
                login. Share the credentials securely before
                leaving this page.
              </p>

              {loginError && (
                <p
                  role="alert"
                  className="text-sm text-destructive sm:col-span-2"
                >
                  {loginError}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={disabled}
            className="min-h-10"
          >
            {busy && (
              <Loader2
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            )}

            {busy
              ? "Saving..."
              : editing
                ? "Save profile changes"
                : "Create employee & login"}
          </Button>

          {busy && (
            <span
              role="status"
              className="text-sm text-muted-foreground"
            >
              Saving employee. Please wait.
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
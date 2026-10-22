import { useId, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
    hint: "This does not create or change a login account.",
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
  const hintId = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={
        wide
          ? "min-w-0 space-y-2 sm:col-span-2"
          : "min-w-0 space-y-2"
      }
    >
      <label
        htmlFor={id}
        className="block text-sm font-medium"
      >
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
          aria-describedby={hintId}
          aria-invalid={!!error}
          className={`${CONTROL_CLASS} resize-y`}
        />
      ) : (
        <Input
          {...props}
          id={id}
          aria-describedby={hintId}
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
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
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
    reason: "",
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

    void onSubmit({
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
        reason: values.reason.trim(),
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
          {editing ? "Edit employee profile" : "Create employee"}
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
              error={issues.find(issue => issue.field === 'employeeCode')?.message}
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
                error={issues.find(issue => issue.field === field.name)?.message}
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

              <Field
                id={`${prefix}-reason`}
                name="reason"
                label="Employment record reason"
                value={values.reason}
                onChange={handleChange}
                maxLength={1000}
                required
                multiline
                wide
                disabled={disabled}
                hint="Explain why this employment record is being created."
              />
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
                : "Create employee"}
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

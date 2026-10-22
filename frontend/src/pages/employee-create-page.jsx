import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

import EmployeeForm from "@/components/employees/employee-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { createEmployee } from "@/services/employee.service";

const UNCERTAIN_RESPONSE_CODES = new Set([
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
  "INVALID_RESPONSE",
]);

function getValidationIssues(details) {
  if (!Array.isArray(details)) {
    return [];
  }

  return details
    .filter(
      (issue) =>
        issue &&
        typeof issue.message === "string"
    )
    .map((issue) => ({
      field:
        typeof issue.field === "string"
          ? issue.field
          : "",
      message: issue.message,
    }));
}

export default function EmployeeCreatePage() {
  const { getCsrfToken, refreshSession } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [createdEmployee, setCreatedEmployee] = useState(null);

  const submittingRef = useRef(false);
  const errorRef = useRef(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  async function handleCreate(data) {
    if (
      submittingRef.current ||
      createdEmployee ||
      error?.uncertain
    ) {
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setError(null);

    let requestStarted = false;

    try {
      const csrfToken = getCsrfToken();

      requestStarted = true;

      const employee = await createEmployee(data, {
        csrfToken,
      });

      setCreatedEmployee(employee);
    } catch (requestError) {
      const uncertain =
        requestStarted &&
        (
          UNCERTAIN_RESPONSE_CODES.has(requestError.code) ||
          requestError.status >= 500
        );

      setError({
        message:
          requestError.message ||
          "The employee could not be created.",
        issues: getValidationIssues(requestError.details),
        uncertain,
      });

      if (
        requestError.status === 401 ||
        requestError.code === "PASSWORD_CHANGE_REQUIRED"
      ) {
        void refreshSession();
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (createdEmployee) {
    return (
      <section
        aria-labelledby="employee-created-title"
        className="mx-auto w-full max-w-3xl space-y-6"
      >
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-600/30 bg-emerald-600/10 p-4"
        >
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400"
            aria-hidden="true"
          />

          <div className="min-w-0">
            <h1
              id="employee-created-title"
              className="text-xl font-semibold"
            >
              Employee created successfully
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              The employee profile and initial employment
              record have been saved.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Saved employee</h2>
            </CardTitle>
          </CardHeader>

          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-sm text-muted-foreground">
                  Employee code
                </dt>
                <dd className="mt-1 break-words font-medium">
                  {createdEmployee.employeeCode}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-sm text-muted-foreground">
                  Full name
                </dt>
                <dd className="mt-1 break-words font-medium">
                  {createdEmployee.fullName}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-muted-foreground">
                  Joining date
                </dt>
                <dd className="mt-1 font-medium">
                  {createdEmployee.employment.startDate}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-muted-foreground">
                  Employment status
                </dt>
                <dd className="mt-1 font-medium">
                  {createdEmployee.employment.status === "PROBATION"
                    ? "Probation"
                    : "Active"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Link className="inline-flex min-h-10 items-center text-primary underline" to={`/employees/${createdEmployee.id}`}>View employee details</Link>

        <Link
          to="/employees"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Go to employee directory
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="employee-create-title"
      className="mx-auto w-full max-w-4xl space-y-6"
    >
      <div className="space-y-3">
        {!busy && (
          <Link
            to="/employees"
            className="inline-flex min-h-9 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Employee directory
          </Link>
        )}

        <div>
          <h1
            id="employee-create-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Add employee
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Create an employee profile and initial employment
            record. Login account provisioning is separate.
          </p>
        </div>
      </div>

      {error && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start gap-3">
            <AlertCircle
              className="mt-0.5 size-5 shrink-0 text-destructive"
              aria-hidden="true"
            />

            <div className="min-w-0 space-y-3">
              <p className="break-words text-sm font-medium">
                {error.message}
              </p>

              {error.issues.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {error.issues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`}>
                      {issue.field && (
                        <span className="font-medium">
                          {issue.field}:{" "}
                        </span>
                      )}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              {error.uncertain && (
                <>
                  <p className="text-sm leading-relaxed">
                    The save result could not be confirmed.
                    The employee may already have been created.
                    Check the directory using the employee code
                    before attempting another submission.
                  </p>

                  <Link
                    to="/employees"
                    className="inline-flex min-h-9 items-center rounded-lg text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Check employee directory
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <EmployeeForm
        onSubmit={handleCreate}
        busy={busy}
        blocked={error?.uncertain === true}
        issues={error?.issues || []}
      />
    </section>
  );
}

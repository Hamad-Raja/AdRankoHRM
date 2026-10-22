import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";
import { listEmployees } from "@/services/employee.service";

const STATUS_OPTIONS = [
  ["PROBATION", "Probation"],
  ["ACTIVE", "Active"],
  ["NOTICE_PERIOD", "Notice period"],
  ["SUSPENDED", "Suspended"],
  ["EXITED", "Exited"],
];

const STATUS_STYLES = {
  PROBATION:
    "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  ACTIVE:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  NOTICE_PERIOD:
    "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  SUSPENDED:
    "border-rose-600/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
  EXITED:
    "border-border bg-muted text-muted-foreground",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const SELECT_CLASS =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function formatDate(value) {
  return value
    ? DATE_FORMATTER.format(new Date(`${value}T00:00:00.000Z`))
    : "Not set";
}

function EmploymentBadge({ status }) {
  const label =
    STATUS_OPTIONS.find(([value]) => value === status)?.[1] ??
    "No employment";

  return (
    <Badge
      variant="outline"
      className={
        STATUS_STYLES[status] ??
        "border-border bg-muted text-muted-foreground"
      }
    >
      {label}
    </Badge>
  );
}

export default function EmployeesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshSession, pendingAction } = useAuth();

  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "20");
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";

  const [reloadNumber, setReloadNumber] = useState(0);
  const [result, setResult] = useState({
    key: null,
    status: "loading",
    data: null,
    error: null,
  });

  const requestKey = JSON.stringify([
    page,
    pageSize,
    q,
    status,
    reloadNumber,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEmployees() {
      try {
        const data = await listEmployees(
          { page, pageSize, q, status },
          { signal: controller.signal }
        );

        if (controller.signal.aborted) return;

        setResult({
          key: requestKey,
          status: "success",
          data,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setResult({
          key: requestKey,
          status: "error",
          data: null,
          error,
        });

        if (
          error.status === 401 ||
          error.code === "PASSWORD_CHANGE_REQUIRED"
        ) {
          void refreshSession();
        }
      }
    }

    void loadEmployees();

    return () => controller.abort();
  }, [page, pageSize, q, status, requestKey, refreshSession]);

  const isCurrent = result.key === requestKey;
  const isLoading = !isCurrent || result.status === "loading";
  const data =
    isCurrent && result.status === "success" ? result.data : null;
  const error =
    isCurrent && result.status === "error" ? result.error : null;

  const hasFilters = Boolean(q.trim() || status);
  const formKey = JSON.stringify([q, status, pageSize]);
  const employees = data?.employees ?? [];
  const pagination = data?.pagination;

  const firstRecord =
    employees.length > 0
      ? (pagination.page - 1) * pagination.pageSize + 1
      : 0;

  const lastRecord =
    employees.length > 0
      ? firstRecord + employees.length - 1
      : 0;

  function handleSearch(event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const nextQuery = String(form.get("q") ?? "").trim();
    const nextStatus = String(form.get("status") ?? "");
    const nextPageSize = String(form.get("pageSize") ?? "20");

    const nextParams = new URLSearchParams({
      page: "1",
      pageSize: nextPageSize,
    });

    if (nextQuery) nextParams.set("q", nextQuery);
    if (nextStatus) nextParams.set("status", nextStatus);

    setSearchParams(nextParams);
    setReloadNumber((value) => value + 1);
  }

  function resetFilters(event) {
    event.currentTarget.form?.reset();
    setSearchParams({});
    setReloadNumber((value) => value + 1);
  }

  function goToPage(nextPage) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(nextPage));
    setSearchParams(nextParams);
  }

  return (
    <section className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Employees
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            View employee records and employment status.
          </p>
        </div>

        <Link className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring" to="/employees/new">Add employee</Link>
        <Button
          type="button"
          variant="outline"
          className="min-h-10"
          disabled={isLoading || Boolean(pendingAction)}
          onClick={() => setReloadNumber((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent>
          <form
            key={formKey}
            onSubmit={handleSearch}
            aria-label="Employee filters"
            className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_11rem_7rem_auto]"
          >
            <div className="min-w-0 space-y-2">
              <label
                htmlFor="employee-search"
                className="text-sm font-medium"
              >
                Search employees
              </label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="employee-search"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={120}
                  placeholder="Name or employee code"
                  className="h-10 pl-9"
                  disabled={Boolean(pendingAction)}
                />
              </div>
            </div>

            <div className="min-w-0 space-y-2">
              <label
                htmlFor="employee-status"
                className="text-sm font-medium"
              >
                Employment status
              </label>
              <select
                id="employee-status"
                name="status"
                defaultValue={status}
                className={SELECT_CLASS}
                disabled={Boolean(pendingAction)}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 space-y-2">
              <label
                htmlFor="employee-page-size"
                className="text-sm font-medium"
              >
                Per page
              </label>
              <select
                id="employee-page-size"
                name="pageSize"
                defaultValue={String(pageSize)}
                className={SELECT_CLASS}
                disabled={Boolean(pendingAction)}
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                className="min-h-10"
                disabled={Boolean(pendingAction)}
              >
                Search
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-10"
                onClick={resetFilters}
                disabled={Boolean(pendingAction)}
              >
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2 id="employee-results-title">Employee directory</h2>
          </CardTitle>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-sm text-muted-foreground"
          >
            {isLoading
              ? "Loading employees."
              : data
                ? `${pagination.total} ${
                    pagination.total === 1 ? "employee" : "employees"
                  } found.`
                : "Employee records are unavailable."}
          </p>
        </CardHeader>

        <CardContent className="min-w-0" aria-busy={isLoading}>
          {isLoading && (
            <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2
                aria-hidden="true"
                className="size-5 animate-spin motion-reduce:animate-none"
              />
              Loading employee records…
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-destructive"
                />
                <div className="min-w-0">
                  <p className="font-medium">
                    {error.status === 403
                      ? "Access restricted"
                      : "Unable to load employees"}
                  </p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {error.message}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {error.status === 400 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetFilters}
                  >
                    Reset filters
                  </Button>
                ) : error.status === 401 || error.status === 403 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refreshSession()}
                  >
                    Verify session
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setReloadNumber((value) => value + 1)
                    }
                  >
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}

          {data && employees.length === 0 && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-8 text-center">
              <UsersRound
                aria-hidden="true"
                className="size-9 text-muted-foreground"
              />
              <p className="font-medium">
                {pagination.total > 0
                  ? "No employees on this page"
                  : hasFilters
                    ? "No matching employees"
                    : "No employees yet"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {pagination.total > 0
                  ? "Return to the first page to view available records."
                  : hasFilters
                    ? "Try a different name, employee code or status."
                    : "Employee records will appear here once they are added."}
              </p>

              {pagination.total > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goToPage(1)}
                >
                  Go to first page
                </Button>
              ) : hasFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetFilters}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          )}

          {data && employees.length > 0 && (
            <>
              <ul className="divide-y divide-border md:hidden">
                {employees.map((employee) => (
                  <li key={employee.id} className="space-y-3 py-4">
                    <div className="min-w-0">
                      <p className="break-words font-medium [overflow-wrap:anywhere]">
                        <Link className="text-primary underline" to={`/employees/${employee.id}`}>{employee.fullName}</Link>
                      </p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {employee.employeeCode}
                      </p>
                    </div>

                    <EmploymentBadge
                      status={employee.employment?.status}
                    />

                    <p className="text-sm text-muted-foreground">
                      Employment start:{" "}
                      <span className="text-foreground">
                        {formatDate(employee.employment?.startDate)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>

              <div
                role="region"
                aria-labelledby="employee-results-title"
                tabIndex={0}
                className="hidden overflow-x-auto rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring md:block"
              >
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <caption className="sr-only">
                    Employee names, codes, employment statuses and
                    employment start dates.
                  </caption>
                  <thead className="bg-muted/50">
                    <tr>
                      {[
                        "Employee",
                        "Employee code",
                        "Status",
                        "Employment start",
                      ].map((heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-4 py-3 font-medium text-muted-foreground"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {employees.map((employee) => (
                      <tr key={employee.id} className="hover:bg-muted/30">
                        <th
                          scope="row"
                          className="max-w-80 break-words px-4 py-4 font-medium [overflow-wrap:anywhere]"
                        >
                          <Link className="text-primary underline" to={`/employees/${employee.id}`}>{employee.fullName}</Link>
                        </th>
                        <td className="px-4 py-4 text-muted-foreground">
                          {employee.employeeCode}
                        </td>
                        <td className="px-4 py-4">
                          <EmploymentBadge
                            status={employee.employment?.status}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          {formatDate(employee.employment?.startDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {data && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                {employees.length > 0
                  ? `${firstRecord}–${lastRecord} of ${pagination.total}`
                  : `0 of ${pagination.total}`}{" "}
                employees
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10"
                  disabled={
                    pagination.page <= 1 || Boolean(pendingAction)
                  }
                  onClick={() => goToPage(pagination.page - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>

                <span className="px-1 text-sm text-muted-foreground">
                  Page {pagination.page}
                  {pagination.totalPages >= pagination.page
                    ? ` of ${pagination.totalPages}`
                    : ""}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10"
                  disabled={
                    pagination.page >= pagination.totalPages ||
                    Boolean(pendingAction)
                  }
                  onClick={() => goToPage(pagination.page + 1)}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Download, RefreshCw, X } from "lucide-react";

import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { organization } from "@/services/organization.service";
import {
  getReport,
  downloadReport,
} from "@/services/reports.service";

import {
  REPORT_ZONE,
  STATUS_LABELS,
  ATTENDANCE_STATUSES,
  initialReportFilters,
  monthDates,
  reportQuery,
  formatReportTime,
  formatReportMinutes,
} from "@/lib/reports";

const SELECT =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring";

const CELL = "px-4 py-3 align-top text-sm";

const TAB_LABELS = {
  monthly: "Monthly summary",
  attendance: "Attendance details",
  corrections: "Corrections & decisions",
};

function Badge({ value }) {
  const attention = [
    "MISSING_CHECKOUT",
    "NO_CLOCK_IN",
    "REJECTED",
  ].includes(value);

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${
        attention
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-foreground"
      }`}
    >
      {STATUS_LABELS[value] ||
        value?.replaceAll("_", " ") ||
        "—"}
    </span>
  );
}

function Person({ employee }) {
  return (
    <div>
      <p className="font-medium">{employee.fullName}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {employee.employeeCode}
      </p>
    </div>
  );
}

function Interval({
  value,
  minutes,
  empty = "No interval recorded",
}) {
  if (!value) {
    return <span className="text-muted-foreground">{empty}</span>;
  }

  return (
    <div className="min-w-48 space-y-1 text-xs">
      <p>In: {formatReportTime(value.clockInAt)}</p>
      <p>Out: {formatReportTime(value.clockOutAt)}</p>

      {minutes !== undefined && (
        <p className="font-medium">
          Elapsed: {formatReportMinutes(minutes)}
        </p>
      )}
    </div>
  );
}

function ReportRows({ kind, rows, onEmployee }) {
  if (kind === "monthly") {
    const headings = [
      "Employee",
      "Scheduled duties",
      "Clock-ins",
      "Late",
      "No clock-in",
      "Unresolved checkout",
      "Raw elapsed",
      "Approved intervals",
      "Details",
    ];

    return (
      <>
        <thead>
          <tr>
            {headings.map((title) => (
              <th
                key={title}
                scope="col"
                className={`${CELL} whitespace-nowrap font-semibold`}
              >
                {title}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={row.employee.id}
              className="hover:bg-muted/30"
            >
              <td className={CELL}>
                <Person employee={row.employee} />
              </td>

              {[
                "eligibleDuties",
                "actualRecords",
                "late",
                "noClockIn",
                "unresolvedMissingCheckout",
              ].map((field) => (
                <td key={field} className={CELL}>
                  {row.metrics[field]}
                </td>
              ))}

              <td className={CELL}>
                <p>
                  {formatReportMinutes(
                    row.metrics.rawWorkedMinutes
                  )}
                </p>

                {row.metrics.rawDurationUnknown > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.metrics.rawDurationUnknown} raw durations
                    unavailable
                  </p>
                )}
              </td>

              <td className={CELL}>
                <p>
                  {formatReportMinutes(
                    row.metrics.approvedIntervalMinutes
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Separate from raw elapsed
                </p>
              </td>

              <td className={CELL}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEmployee(row.employee)}
                >
                  View duties
                  <ArrowRight
                    className="ml-1 size-3"
                    aria-hidden="true"
                  />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </>
    );
  }

  if (kind === "attendance") {
    const headings = [
      "Employee",
      "Duty start date",
      "Team",
      "Original punches · PKT",
      "Approved interval · PKT",
      "Classification",
      "Original flags",
    ];

    return (
      <>
        <thead>
          <tr>
            {headings.map((title) => (
              <th
                key={title}
                scope="col"
                className={`${CELL} whitespace-nowrap font-semibold`}
              >
                {title}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const approved =
              row.approvedAdjustment || row.approvedException;

            return (
              <tr
                key={`${row.employee.id}:${row.shiftDate}`}
                className="hover:bg-muted/30"
              >
                <td className={CELL}>
                  <Person employee={row.employee} />
                </td>

                <td
                  className={`${CELL} whitespace-nowrap font-mono text-xs`}
                >
                  {row.shiftDate}
                </td>

                <td className={CELL}>
                  {row.organization?.team?.name || "—"}
                </td>

                <td className={CELL}>
                  <Interval
                    value={row.actual}
                    minutes={row.actual?.workedMinutes}
                    empty="No server punch"
                  />
                </td>

                <td className={CELL}>
                  <Interval
                    value={approved}
                    minutes={approved?.minutes}
                    empty="No approved interval"
                  />

                  {row.approvedException && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Approved exception; no server punch
                    </p>
                  )}
                </td>

                <td className={CELL}>
                  <Badge value={row.classification} />

                  {row.actual?.rawMissingCheckout &&
                    !row.unresolvedMissingCheckout && (
                      <p className="mt-2 max-w-48 text-xs text-muted-foreground">
                        Original exit is missing; an approved
                        adjustment resolves the exception.
                      </p>
                    )}
                </td>

                <td className={CELL}>
                  <div className="flex min-w-28 flex-wrap gap-1">
                    {row.actual?.isLate && (
                      <Badge value="LATE" />
                    )}

                    {row.actual?.isEarlyDeparture && (
                      <Badge value="EARLY_DEPARTURE" />
                    )}

                    {row.actual?.isAfterScheduleEnd && (
                      <Badge value="AFTER_SCHEDULE_END" />
                    )}

                    {row.actual && !row.actual.isLate && (
                      <span className="text-xs text-muted-foreground">
                        Entry within grace
                      </span>
                    )}

                    {!row.actual && "—"}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </>
    );
  }

  const headings = [
    "Employee",
    "Duty / request",
    "Original snapshot · PKT",
    "Proposed times · PKT",
    "Decision",
    "Approved interval · PKT",
    "Reason and review",
  ];

  return (
    <>
      <thead>
        <tr>
          {headings.map((title) => (
            <th
              key={title}
              scope="col"
              className={`${CELL} whitespace-nowrap font-semibold`}
            >
              {title}
            </th>
          ))}
        </tr>
      </thead>

      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-muted/30">
            <td className={CELL}>
              <Person employee={row.employee} />
            </td>

            <td className={CELL}>
              <p className="whitespace-nowrap font-mono text-xs">
                {row.shiftDate}
              </p>
              <p className="mt-1 text-xs">
                {row.requestType?.replaceAll("_", " ")}
              </p>
            </td>

            <td className={CELL}>
              <Interval
                value={row.original}
                empty="No original server snapshot"
              />
            </td>

            <td className={CELL}>
              <Interval
                value={{
                  clockInAt: row.proposedClockInAt,
                  clockOutAt: row.proposedClockOutAt,
                }}
              />
            </td>

            <td className={CELL}>
              <Badge value={row.status} />
              <p className="mt-2 whitespace-nowrap text-xs text-muted-foreground">
                {formatReportTime(row.reviewedAt)}
              </p>
            </td>

            <td className={CELL}>
              <Interval
                value={row.approvedInterpretation}
                minutes={row.approvedInterpretation?.minutes}
                empty="No approved interpretation"
              />
            </td>

            <td className={`${CELL} min-w-64 max-w-sm`}>
              <p className="whitespace-pre-wrap break-words">
                {row.reason}
              </p>

              {row.reviewReason && (
                <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  Review: {row.reviewReason}
                  {row.reviewer ? ` · ${row.reviewer}` : ""}
                </p>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function ReportView({
  kind,
  seed,
  user,
  refreshSession,
  onEmployee,
}) {
  const management = ["ADMIN", "HR"].includes(user.role);

  const [applied, setApplied] = useState(
    () => seed || initialReportFilters()
  );
  const [draft, setDraft] = useState(() => ({ ...applied }));
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState("");
  const [unitsResult, setUnitsResult] = useState(null);
  const [exporting, setExporting] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");

  const downloadRequest = useRef(null);

  const query = reportQuery(applied, kind, page);
  const requestKey = `${query}|${revision}`;
  const current = result?.key === requestKey ? result : null;
  const data = current?.data || null;
  const loading = !current;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const units = unitsResult?.units || [];

  const expectedAccess = management
    ? "ORGANIZATION"
    : user.role === "EMPLOYEE" || kind === "corrections"
      ? "OWN"
      : "DATED_TEAM_AND_OWN";

  useEffect(() => {
    const controller = new AbortController();

    getReport(kind, query, {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;

        if (value.meta.access !== expectedAccess) {
          setResult({
            key: requestKey,
            data: null,
            error:
              "Your report access changed. Refreshing your session…",
          });
          void refreshSession();
          return;
        }

        if (
          value.totalPages > 0 &&
          value.page > value.totalPages
        ) {
          setPage(value.totalPages);
          return;
        }

        setResult({
          key: requestKey,
          data: value,
          error: "",
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;

        setResult({
          key: requestKey,
          data: null,
          error: error.message || "Unable to load reports.",
        });

        if (
          error.status === 401 ||
          ["PASSWORD_CHANGE_REQUIRED", "FORBIDDEN"].includes(
            error.code
          )
        ) {
          void refreshSession();
        }
      });

    return () => controller.abort();
  }, [
    kind,
    query,
    requestKey,
    expectedAccess,
    refreshSession,
  ]);

  useEffect(() => {
    if (!management) return;

    const controller = new AbortController();

    organization({ signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setUnitsResult({
            units: Array.isArray(value.units) ? value.units : [],
            error: "",
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;

        setUnitsResult({
          units: [],
          error:
            error.message || "Organization filters are unavailable.",
        });

        if (
          error.status === 401 ||
          ["PASSWORD_CHANGE_REQUIRED", "FORBIDDEN"].includes(
            error.code
          )
        ) {
          void refreshSession();
        }
      });

    return () => controller.abort();
  }, [management, refreshSession]);

  useEffect(
    () => () => {
      const controller = downloadRequest.current;
      downloadRequest.current = null;
      controller?.abort();
    },
    []
  );

  function change(field, value) {
    setDraft((previous) => {
      const next = { ...previous, [field]: value };

      if (["departmentId", "campaignId"].includes(field)) {
        next.teamId = "";
      }

      if (field === "month") {
        try {
          Object.assign(next, monthDates(value));
        } catch {
          // Validate the completed value on Apply.
        }
      }

      return next;
    });

    setFormError("");
  }

  function apply(event) {
    event.preventDefault();

    try {
      reportQuery(draft, kind);

      const normalized = {
        ...draft,
        search: draft.search.trim(),
      };

      setDraft(normalized);
      setApplied(normalized);
      setPage(1);
      setRevision((value) => value + 1);
      setFormError("");
      setDownloadMessage("");
    } catch (error) {
      setFormError(error.message);
    }
  }

  function reset() {
    const value = initialReportFilters();

    setDraft(value);
    setApplied(value);
    setPage(1);
    setRevision((number) => number + 1);
    setFormError("");
    setDownloadMessage("");
  }

  async function exportFile(format) {
    if (!data || dirty || downloadRequest.current) return;

    const controller = new AbortController();
    downloadRequest.current = controller;

    setExporting(format);
    setDownloadMessage("");

    try {
      const file = await downloadReport(
        kind,
        query,
        data.meta,
        format,
        { signal: controller.signal }
      );

      if (
        controller.signal.aborted ||
        downloadRequest.current !== controller
      ) {
        return;
      }

      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);

      try {
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }

      setDownloadMessage(
        `${format.toUpperCase()} download requested.`
      );
    } catch (error) {
      if (controller.signal.aborted) return;

      setDownloadMessage(
        error.message || "Download failed. Try again."
      );

      if (
        error.status === 401 ||
        ["PASSWORD_CHANGE_REQUIRED", "FORBIDDEN"].includes(
          error.code
        )
      ) {
        void refreshSession();
      }
    } finally {
      if (downloadRequest.current === controller) {
        downloadRequest.current = null;
        setExporting("");
      }
    }
  }

  const statuses =
    kind === "corrections"
      ? ["PENDING", "APPROVED", "REJECTED"]
      : ATTENDANCE_STATUSES;

  const cards =
    kind === "corrections"
      ? [
          ["Requests", "requests"],
          ["Pending", "pending"],
          ["Approved", "approved"],
          ["Rejected", "rejected"],
        ]
      : [
          ["Recorded entries", "actualRecords"],
          ["Late entries", "late"],
          ["No clock-in", "noClockIn"],
          ["Unresolved checkouts", "unresolvedMissingCheckout"],
          ["Raw elapsed", "rawWorkedMinutes", true],
          ["Approved intervals", "approvedIntervalMinutes", true],
        ];

  return (
    <div className="space-y-5">
      <form
        onSubmit={apply}
        className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kind !== "monthly" && (
            <label className="space-y-1 text-sm font-medium">
              Period
              <select
                aria-label="Report period type"
                className={SELECT}
                value={draft.periodMode}
                onChange={(event) =>
                  change("periodMode", event.target.value)
                }
              >
                <option value="month">Month</option>
                <option value="range">Date range</option>
              </select>
            </label>
          )}

          {kind === "monthly" || draft.periodMode === "month" ? (
            <label className="space-y-1 text-sm font-medium">
              Month
              <Input
                aria-label="Report month"
                type="month"
                min="0001-01"
                value={draft.month}
                required
                onChange={(event) =>
                  change("month", event.target.value)
                }
              />
            </label>
          ) : (
            <>
              <label className="space-y-1 text-sm font-medium">
                From duty date
                <Input
                  type="date"
                  aria-label="From duty date"
                  value={draft.dateFrom}
                  required
                  onChange={(event) =>
                    change("dateFrom", event.target.value)
                  }
                />
              </label>

              <label className="space-y-1 text-sm font-medium">
                To duty date
                <Input
                  type="date"
                  aria-label="To duty date"
                  value={draft.dateTo}
                  required
                  onChange={(event) =>
                    change("dateTo", event.target.value)
                  }
                />
              </label>
            </>
          )}

          <label className="space-y-1 text-sm font-medium">
            Employee search
            <Input
              aria-label="Report employee search"
              placeholder="Name or employee code"
              maxLength={120}
              value={draft.search}
              onChange={(event) =>
                change("search", event.target.value)
              }
            />
          </label>

          {kind !== "monthly" && (
            <label className="space-y-1 text-sm font-medium">
              Status
              <select
                aria-label="Report status"
                className={SELECT}
                value={draft.status}
                onChange={(event) =>
                  change("status", event.target.value)
                }
              >
                <option value="">All statuses</option>

                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {management &&
            [
              ["DEPARTMENT", "departmentId", "Department"],
              ["CAMPAIGN", "campaignId", "Campaign"],
              ["TEAM", "teamId", "Team"],
            ].map(([unitKind, field, label]) => (
              <label
                key={field}
                className="space-y-1 text-sm font-medium"
              >
                {label}
                <select
                  aria-label={`Report ${label.toLowerCase()}`}
                  className={SELECT}
                  value={draft[field]}
                  disabled={
                    !unitsResult || Boolean(unitsResult.error)
                  }
                  onChange={(event) =>
                    change(field, event.target.value)
                  }
                >
                  <option value="">
                    All {label.toLowerCase()}s
                  </option>

                  {units
                    .filter(
                      (unit) =>
                        unit.kind === unitKind &&
                        (unitKind !== "TEAM" ||
                          ((!draft.departmentId ||
                            unit.departmentId ===
                              draft.departmentId) &&
                            (!draft.campaignId ||
                              unit.campaignId ===
                                draft.campaignId)))
                    )
                    .map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                        {unit.archivedAt ? " (archived)" : ""}
                      </option>
                    ))}
                </select>
              </label>
            ))}
        </div>

        {draft.employeeId && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-2 text-sm">
            <span>
              Selected employee: {draft.employeeLabel}
            </span>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setDraft((value) => ({
                  ...value,
                  employeeId: "",
                  employeeLabel: "",
                }))
              }
            >
              <X className="mr-1 size-3" aria-hidden="true" />
              Clear employee
            </Button>
          </div>
        )}

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        {unitsResult?.error && (
          <p role="alert" className="text-sm text-destructive">
            Organization filters: {unitsResult.error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={Boolean(exporting)}
          >
            Apply filters
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={Boolean(exporting)}
            onClick={reset}
          >
            Reset
          </Button>

          {dirty && (
            <span className="text-xs text-muted-foreground">
              Apply your changes to update results and exports.
            </span>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {data ? (
            <>
              <span>
                {data.total}{" "}
                {kind === "monthly"
                  ? "employee summaries"
                  : "matching rows"}
              </span>
              <p className="mt-1 text-xs">
                {data.meta.period.dateFrom} →{" "}
                {data.meta.period.dateTo} · As of{" "}
                {formatReportTime(data.meta.generatedAt)} PKT
              </p>
            </>
          ) : loading ? (
            "Loading report…"
          ) : (
            "Report unavailable"
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={loading || dirty || Boolean(exporting)}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw
              className={`mr-2 size-4 ${
                loading ? "animate-spin" : ""
              }`}
              aria-hidden="true"
            />
            Refresh
          </Button>

          {["csv", "xlsx"].map((format) => (
            <Button
              key={format}
              type="button"
              variant="outline"
              disabled={
                !data || loading || dirty || Boolean(exporting)
              }
              onClick={() => exportFile(format)}
            >
              <Download
                className="mr-2 size-4"
                aria-hidden="true"
              />
              {exporting === format
                ? "Preparing…"
                : format.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Exports use the applied filters and re-read the latest
        authorized data. CSV protects codes with a leading
        apostrophe; XLSX preserves their original text.
      </p>

      {downloadMessage && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-3 text-sm"
        >
          {downloadMessage}
        </p>
      )}

      {current?.error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {current.error}
        </div>
      )}

      {data &&
        data.meta.currentPolicyState !==
          "EFFECTIVE_POLICY_PRESENT" && (
          <p className="rounded-xl border border-border bg-muted p-4 text-sm">
            {data.meta.currentPolicyState === "FUTURE_POLICY_ONLY"
              ? "Only a future attendance policy is activated. Earlier dates remain setup-required."
              : "There is no activated attendance policy. Eligible dates remain setup-required until an approved start is activated."}
          </p>
        )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, field, minutes]) => (
          <div
            key={field}
            className="rounded-xl border border-border bg-card p-4"
          >
            <p className="text-xs text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {data
                ? minutes
                  ? formatReportMinutes(data.totals[field])
                  : (data.totals[field] ?? "—")
                : "—"}
            </p>
          </div>
        ))}
      </div>

      {data?.totals.rawDurationUnknown > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.totals.rawDurationUnknown} original records have
          unavailable raw durations. They are excluded from the
          raw elapsed sum.
        </p>
      )}

      <div
        role="region"
        aria-label="Report results"
        tabIndex={0}
        aria-busy={loading}
        className="max-w-full overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-ring"
      >
        {loading ? (
          <p
            role="status"
            className="p-8 text-center text-sm text-muted-foreground"
          >
            Loading report…
          </p>
        ) : !data ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Refresh the report to try again.
          </p>
        ) : !data.rows.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No results for the applied filters.
          </p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">
              {TAB_LABELS[kind]} in {REPORT_ZONE}
            </caption>
            <ReportRows
              kind={kind}
              rows={data.rows}
              onEmployee={(employee) =>
                onEmployee(employee, applied)
              }
            />
          </table>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>
            Page {data.page} of {data.totalPages} · 20 rows per page
          </span>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={
                loading || page <= 1 || Boolean(exporting)
              }
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={
                loading ||
                page >= data.totalPages ||
                Boolean(exporting)
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        Duty dates use the evening start date: Friday
        19:00–Saturday 05:00 belongs to Friday. Late and departure
        flags can overlap. Original punches and approved
        intervals remain separate; neither is a payable-time or
        salary calculation.
      </p>
    </div>
  );
}

function ReportsWorkspace({ user, refreshSession }) {
  const [view, setView] = useState({
    kind: "monthly",
    seed: null,
  });

  function employeeDetails(employee, filters) {
    setView({
      kind: "attendance",
      seed: {
        ...filters,
        status: "",
        employeeId: employee.id,
        employeeLabel: `${employee.fullName} (${employee.employeeCode})`,
      },
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Reports
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Monthly attendance, original evidence and approved
          decisions · {REPORT_ZONE}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {["ADMIN", "HR"].includes(user.role)
            ? "Organization reports"
            : user.role === "MANAGER"
              ? "Your historical team scope and own attendance. Correction decisions are own-only."
              : "Your own employee reports"}
        </p>
      </header>

      <div
        role="group"
        aria-label="Report type"
        className="flex flex-wrap gap-2"
      >
        {Object.entries(TAB_LABELS).map(([kind, label]) => (
          <Button
            key={kind}
            type="button"
            variant={view.kind === kind ? "default" : "outline"}
            aria-pressed={view.kind === kind}
            onClick={() => setView({ kind, seed: null })}
          >
            {label}
          </Button>
        ))}
      </div>

      <ReportView
        key={`${view.kind}:${view.seed?.employeeId || "all"}`}
        kind={view.kind}
        seed={view.seed}
        user={user}
        refreshSession={refreshSession}
        onEmployee={employeeDetails}
      />
    </div>
  );
}

export default function ReportsPage() {
  const { user, refreshSession } = useAuth();

  return user ? (
    <ReportsWorkspace
      key={`${user.id}:${user.role}`}
      user={user}
      refreshSession={refreshSession}
    />
  ) : null;
}
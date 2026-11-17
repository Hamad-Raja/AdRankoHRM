import {
  attendancePeriodMessage,
  attendanceCalendarLabel,
} from "@/lib/attendance-clock-presentation";
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Coins,
  Layers3,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import AttendanceClock from "@/components/attendance-clock";
import { karachiMonth } from "@/lib/reports";
import {
  useHrRead,
  useHrAttendance,
} from "@/components/dashboard/use-hr-dashboard";
import {
  attendancePeriod,
  dateLabel,
  departments,
  departmentColors,
  greeting,
  number,
  percentage,
} from "@/components/dashboard/hr-dashboard-data";
import {
  AttendanceTrend,
  Donut,
} from "@/components/dashboard/hr-dashboard-charts";
import {
  DashboardCard as Card,
  ResourceState as State,
  RecentAnnouncements,
} from "@/components/dashboard/dashboard-panels";
import DashboardHeadset from "@/components/dashboard/dashboard-headset";
import "@/components/dashboard/hr-dashboard.css";
function KPI({
  label,
  value,
  icon: Icon,
  tone = "green",
  hint,
  loading,
  error,
}) {
  return (
    <article aria-label={label} className={`hr-kpi hr-kpi-${tone}`}>
      <span className="hr-kpi-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <h2>{label}</h2>
        <p className="hr-kpi-value" aria-live="polite">
          {loading
            ? "…"
            : error || !number(value)
              ? "—"
              : value.toLocaleString("en-GB")}
        </p>
        <p className="hr-kpi-hint">
          {error ? "Temporarily unavailable" : hint}
        </p>
      </div>
    </article>
  );
}
function Attendance({ resource, period, setPeriod, anchor, settings }) {
  const summary = resource.data ? attendancePeriod(resource.data) : null,
    unit = period === "today" ? "employees" : "duties";
  const controls = (
    <div className="hr-periods" role="group" aria-label="Attendance period">
      {[
        ["today", "Today"],
        ["week", "This Week"],
        ["month", "This Month"],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === period}
          onClick={() => setPeriod(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const items =
    summary && ["READY", "EMPTY"].includes(summary.state)
      ? [
          {
            label: "Present",
            count: summary.present,
            color: "var(--hr-emerald)",
          },
          { label: "Absent", count: summary.absent, color: "var(--hr-red)" },
          { label: "On Leave", count: summary.leave, color: "var(--hr-amber)" },
          {
            label: "Pending ",
            count: summary.pending,
            color: "var(--hr-slate)",
          },
          {
            label: "Approved Exceptions",
            count: summary.exceptions,
            color: "var(--hr-teal)",
          },
        ]
      : [];
  return (
    <Card
      title="Attendance Overview"
      icon={CalendarCheck}
      controls={controls}
      className="hr-attendance"
    >
      <State resource={resource} label="attendance overview">
        {summary &&
          (["READY", "EMPTY"].includes(summary.state) ? (
            <>
              <div className="hr-attendance-charts">
                <div className="hr-distribution">
                  <Donut
                    segments={items}
                    total={summary.total}
                    center={summary.rate == null ? "—" : summary.rate + "%"}
                    caption="Present"
                    label={`Attendance distribution: ${items.map((i) => i.label + " " + i.count).join(", ")}, ${summary.pending + summary.exceptions} pending or approved exceptions`}
                  />
                  <div className="hr-attendance-legend">
                    {items.map((item) => (
                      <div key={item.label}>
                        <span className="hr-legend-label">
                          <i style={{ background: item.color }} />
                          {item.label}
                        </span>
                        <strong>
                          {item.count}{" "}
                          <span>
                            ({percentage(item.count, summary.total) ?? "—"}
                            {summary.total ? "%" : ""})
                          </span>
                        </strong>
                      </div>
                    ))}
                    <div className="hr-eligible">
                      <UsersRound aria-hidden="true" />
                      <div>
                        <span>Total eligible {unit}</span>
                        <strong>{summary.total}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <AttendanceTrend days={resource.data} />
              </div>
              <div className="hr-attendance-notes">
                <span>
                  {attendanceCalendarLabel(
                    resource.data.map((day) => day.report),
                  ) &&
                    `${attendanceCalendarLabel(resource.data.map((day) => day.report))} ? `}
                  {period === "today"
                    ? `Duty start: ${dateLabel(anchor, true)}`
                    : `${dateLabel(resource.data[0].date, true)} – ${dateLabel(anchor, true)} · employee-duty totals`}
                </span>
                <span>
                  {summary.pending} pending · {summary.exceptions} approved
                  exceptions · {summary.excluded} off / holiday / ineligible
                </span>
              </div>
            </>
          ) : (
            <div className="hr-attendance-setup">
              <span className="hr-setup-icon">
                <CalendarDays aria-hidden="true" />
              </span>
              <div>
                <h3>
                  {
                    attendancePeriodMessage({
                      state: summary.state,
                      reports: resource.data.map((day) => day.report),
                      settings,
                    }).title
                  }
                </h3>
                <p>
                  {
                    attendancePeriodMessage({
                      state: summary.state,
                      reports: resource.data.map((day) => day.report),
                      settings,
                    }).detail
                  }
                </p>
                {attendancePeriodMessage({
                  state: summary.state,
                  reports: resource.data.map((day) => day.report),
                  settings,
                }).setupRequired && (
                  <Link to="/attendance-settings">
                    Review attendance setup <ArrowUpRight aria-hidden="true" />
                  </Link>
                )}
              </div>
              <div className="hr-setup-visual" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          ))}
      </State>
    </Card>
  );
}
function Departments({ resource, total, units }) {
  const rows =
      resource.data && total != null && units
        ? departments(resource.data, total, units)
        : null,
    colors = units ? departmentColors(units) : null;
  const segments = rows?.map((row) => ({
    ...row,
    color:
      row.id === "unassigned"
        ? "var(--hr-department-unassigned)"
        : colors.get(row.id),
  }));
  return (
    <Card
      title="Department-Wise Employees"
      icon={Layers3}
      className="hr-departments"
    >
      <State resource={resource} label="department employees">
        {rows ? (
          <>
            <p className="hr-card-subtitle">
              All profiles 
            </p>
            <div className="hr-department-chart">
              <Donut
                segments={segments}
                total={total}
                center={total}
                caption="Employees"
                label={`Department distribution: ${rows.map((r) => r.label + " " + r.count).join(", ") || "No employee profiles"}`}
              />
              <ul className="hr-department-legend">
                {segments.map((row) => (
                  <li key={row.id}>
                    <span className="hr-legend-label">
                      <i style={{ background: row.color }} />
                      {row.label}
                    </span>
                    <strong>
                      {row.count}{" "}
                      <span>({percentage(row.count, total) ?? 0}%)</span>
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <div className="hr-state">
            <p>Department totals unavailable</p>
            <p className="hr-muted">
              Refresh the overview to reconcile employee profiles.
            </p>
          </div>
        )}
      </State>
    </Card>
  );
}
function Duty({ resource, settings, onRecordUpdated, refreshKey }) {
  return (
    <section aria-label="My Duty" className="hr-card hr-duty">
      <AttendanceClock
        presentation="compact"
        scheduleResource={{ ...resource, settings }}
        onRecordUpdated={onRecordUpdated}
        refreshKey={refreshKey}
      />
      <ShieldCheck aria-hidden="true" className="hr-duty-watermark" />
    </section>
  );
}

export default function HrDashboard() {
  const { refreshSession } = useAuth(),
    [revision, setRevision] = useState(0),
    [attendanceRevision, setAttendanceRevision] = useState(0),
    [period, setPeriod] = useState("today"),
    [month, setMonth] = useState(karachiMonth),
    [initialNow] = useState(() => new Date().toISOString()),
    failed = useRef(false);
  const onAuthFailure = useCallback(() => {
    if (!failed.current) {
      failed.current = true;
      void refreshSession();
    }
  }, [refreshSession]);
  const employees = useHrRead("/dashboard/employees", revision, onAuthFailure),
    queues = useHrRead(
      "/dashboard/queues?" + new URLSearchParams({ month }),
      revision,
      onAuthFailure,
    ),
    organization = useHrRead(
      "/organization/scope/employees",
      revision,
      onAuthFailure,
    ),
    shift = useHrRead("/attendance-settings/my-shift", revision, onAuthFailure),
    settings = useHrRead("/attendance-settings", revision, onAuthFailure),
    catalog = useHrRead("/organization", revision, onAuthFailure),
    announcements = useHrRead(
      "/dashboard/announcements",
      revision,
      onAuthFailure,
    );
  const anchor = employees.data?.dutyDate,
    attendance = useHrAttendance(
      anchor,
      period,
      `${revision}:${attendanceRevision}`,
      onAuthFailure,
      settings.data?.versions,
    ),
    emp = employees.data,
    q = queues.data,
    activeRate = emp
      ? percentage(emp.eligibleEmployment, emp.totalProfiles)
      : null,
    instant = emp?.asOf || initialNow;
  const leave = useHrRead(
      anchor
        ? "/reports/attendance?" +
            new URLSearchParams({
              dateFrom: anchor,
              dateTo: anchor,
              pageSize: "1",
            })
        : null,
      revision,
      onAuthFailure,
    ),
    anchorReport = leave.data;
  const attendanceUpdated = useCallback(
    () => setAttendanceRevision((value) => value + 1),
    [],
  );
  const attendanceResource =
    employees.loading || settings.loading
      ? { ...attendance, loading: true }
      : employees.error || settings.error
        ? {
            ...attendance,
            error: employees.error || settings.error,
            retry: employees.error ? employees.retry : settings.retry,
          }
        : attendance;
  const departmentResource = {
    ...organization,
    loading: organization.loading || employees.loading || catalog.loading,
    error: organization.error || employees.error || catalog.error,
    retry: organization.error
      ? organization.retry
      : employees.error
        ? employees.retry
        : catalog.retry,
  };
  const pending = [
      employees,
      queues,
      organization,
      shift,
      settings,
      attendance,
      leave,
      catalog,
      announcements,
    ].some((r) => r.loading),
    rows = q
      ? [
          {
            label: "Attendance Corrections",
            count: q.pendingCorrections,
            to: "/attendance?view=corrections&reviewableOnly=true",
            icon: ClipboardCheck,
          },
          {
            label: "Draft / Returned Payroll ",
            count: q.draftPayroll,
            to:
              "/payroll?" +
              new URLSearchParams({ month: q.payrollMonth, status: "DRAFT" }),
            icon: Coins,
          },
          {
            label: "Leave to Review",
            count: q.reviewableLeaves,
            to: "/leaves?view=management&status=PENDING&allMonths=true&reviewableOnly=true",
            icon: UserCheck,
          },
          {
            label: "Pending Leave (Overall)",
            count: q.pendingLeavesOverall,
            to: "/leaves?view=management&status=PENDING&allMonths=true",
            icon: Clock3,
          },
        ]
      : [];
  return (
    <div className="hr-dashboard">
      <section aria-label="HR welcome" className="hr-welcome">
        <div>
          <p className="hr-eyebrow">YOUR PEOPLE. YOUR WORKPLACE.</p>
          <h1>
            {greeting(instant)}, HR Team{" "}
            <span aria-hidden="true" className="hr-wave">
              &#128075;
            </span>
          </h1>
          <p>
            Here’s your HR overview for today.{" "}
            <span>
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Karachi",
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              }).format(new Date(instant))}
              .
            </span>
          </p>
        </div>
        <DashboardHeadset />
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          disabled={pending}
          onClick={() => setRevision((v) => v + 1)}
          className="hr-refresh"
        >
          <RefreshCw className={pending ? "animate-spin" : ""} />
          <span className="sr-only">Refresh dashboard</span>
        </Button>
      </section>
      <div className="hr-kpis">
        <KPI
          label="Total Employees"
          value={emp?.totalProfiles}
          icon={UsersRound}
          loading={employees.loading}
          error={employees.error}
        //   hint="Employee profiles"
        />
        <KPI
          label="Active Employees"
          value={emp?.eligibleEmployment}
          icon={UserCheck}
          loading={employees.loading}
          error={employees.error}
        //   hint={
        //     activeRate == null
        //       ? "Active employment status"
        //       : `${activeRate}% of profiles - Active, probation & notice period`
        //   }
        />
        <KPI
          label="On Leave"
          value={anchorReport?.totals.paidLeaveDays}
          icon={CalendarCheck}
          tone="amber"
          loading={employees.loading || leave.loading}
          error={employees.error || leave.error}
        //   hint={
        //     anchor
        //       ? `Approved · duty ${dateLabel(anchor, true)}`
        //       : "Approved duty-date leave"
        //   }
        />
        <KPI
          label="Ex-Employees"
          value={emp?.statuses.EXITED}
          icon={LogOut}
          tone="red"
          loading={employees.loading}
          error={employees.error}
        //   hint={
        //     emp
        //       ? `Employees with ended latest employment · as of ${dateLabel(emp.date, true)}`
        //       : "Ended latest employment"
        //   }
        />
      </div>
      {leave.error && (
        <div role="alert" className="hr-inline-error">
          <p>Approved leave unavailable: {leave.error.message}</p>
          <Button variant="outline" size="sm" onClick={leave.retry}>
            Retry approved leave
          </Button>
        </div>
      )}
      {employees.error && (
        <div role="alert" className="hr-inline-error">
          <p>Employee totals unavailable: {employees.error.message}</p>
          <Button variant="outline" size="sm" onClick={employees.retry}>
            Retry employee totals
          </Button>
        </div>
      )}
      <div className="hr-charts-row">
        <Attendance
          settings={settings.data}
          resource={attendanceResource}
          period={period}
          setPeriod={setPeriod}
          anchor={anchor}
        />
        <Departments
          resource={departmentResource}
          total={emp?.totalProfiles}
          units={catalog.data?.units}
        />
      </div>
      <div className="hr-bottom-row">
        <Card
          title="HR Work Queues"
          className="hr-work-queues"
          icon={ClipboardCheck}
          controls={
            <label className="hr-month">
              <span className="sr-only">Payroll summary month</span>
              <input
                type="month"
                aria-label="Payroll summary month"
                value={month}
                onChange={(e) => {
                  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                    setMonth(e.target.value);
                }}
              />
            </label>
          }
        >
          <State resource={queues} label="HR work queues">
            <div className="hr-queues">
              {rows.map((row) => (
                <Link
                  key={row.label}
                  to={row.to}
                  aria-label={
                    {
                      "Attendance Corrections":
                        "Open pending attendance corrections",
                      "Draft / Returned Payroll (HR Review)":
                        "Open draft payroll for HR review",
                      "Leave to Review": "Open leave I can review",
                      "Pending Leave (Overall)": "Open pending leave overall",
                    }[row.label]
                  }
                >
                  <row.icon aria-hidden="true" />
                  <span>{row.label}</span>
                  <strong>{row.count}</strong>
                  <ChevronRight aria-hidden="true" className="hr-queue-arrow" />
                </Link>
              ))}
            </div>
            {/* <p className="hr-card-footnote">
              Payroll: {q?.payrollMonth} · Includes returned drafts. Pending
              Leave (Overall) is informational; Leave to Review excludes your
              own requests. Corrections I can review: {q?.pendingCorrections};
              overall pending (informational): {q?.pendingCorrectionsOverall}.
              Other queues: all dates
            </p> */}
          </State>
        </Card>
        <RecentAnnouncements resource={announcements} quietEmpty />
        <Duty
          settings={settings.data}
          resource={shift}
          onRecordUpdated={attendanceUpdated}
          refreshKey={revision}
        />
      </div>
      {/* <p className="hr-overview-footer">
        <Check aria-hidden="true" />
        Read-only overview
        <span>Asia/Karachi · attendance follows the duty start date</span>
      </p> */}
    </div>
  );
}

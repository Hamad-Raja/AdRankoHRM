import {
  attendancePeriodMessage,
  attendanceCalendarLabel,
} from "@/lib/attendance-clock-presentation";
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import {
  UsersRound,
  UserCheck,
  CalendarCheck,
  LogOut,
  ClipboardCheck,
  Coins,
  FileCheck,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { karachiMonth } from "@/lib/reports";
import { useHrRead } from "@/components/dashboard/use-hr-dashboard";
import {
  DashboardCard,
  ResourceState,
  RecentAnnouncements,
} from "@/components/dashboard/dashboard-panels";
import DashboardHeadset from "@/components/dashboard/dashboard-headset";
import {
  attendanceDay,
  dateLabel,
  greeting,
} from "@/components/dashboard/hr-dashboard-data";
import { validAdminQueues } from "@/components/dashboard/admin-dashboard-data";
import { monthLabel } from "@/components/dashboard/personal-dashboard-data";
import "@/components/dashboard/hr-dashboard.css";
import "@/components/dashboard/admin-dashboard.css";

function KPI({ title, resource, value, hint, icon: Icon, tone = "" }) {
  return (
    <section aria-label={title} className={"hr-kpi " + tone}>
      <span className="hr-kpi-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <h2>{title}</h2>
        <ResourceState resource={resource} label={title.toLowerCase()}>
          <p className="hr-kpi-value">{value ?? "Unavailable"}</p>
          <p className="hr-kpi-hint">{hint}</p>
        </ResourceState>
      </div>
    </section>
  );
}
function Queue({ label, count, to, icon: Icon }) {
  return (
    <Link to={to}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{count}</strong>
      <ChevronRight aria-hidden="true" className="hr-queue-arrow" />
    </Link>
  );
}
function Attendance({ resource, settings, anchor }) {
  const report = resource.data,
    summary = report ? attendanceDay(report, true) : null,
    missing = report?.totals?.unresolvedMissingCheckout ?? 0;
  return (
    <DashboardCard title="Organization Attendance" icon={CalendarCheck}>
      <ResourceState resource={resource} label="organization attendance">
        {summary && (
          <>
            <p className="admin-note">
              {["READY", "EMPTY"].includes(summary.state) &&
                attendanceCalendarLabel(report) &&
                `${attendanceCalendarLabel(report)} ? `}
              Duty start: {anchor} · Asia/Karachi
            </p>
            {["READY", "EMPTY"].includes(summary.state) ? (
              <>
                <dl className="admin-attendance-summary">
                  {[
                    ["Present", summary.present],
                    ["Absent", summary.absent],
                    ["On Leave", summary.leave],
                    ["Pending", summary.pending],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {/* <p className="admin-note">
                  {summary.total} eligible duties · {summary.exceptions}{" "}
                  approved exceptions · {summary.excluded} off / holiday /
                  ineligible.
                </p>
                <p className="admin-note">
                  Missing checkout: {missing} — presence requiring review.
                  Pending duties have not reached the absence cutoff.
                </p> */}
              </>
            ) : (
              <div className="admin-state">
                <h3>
                  {
                    attendancePeriodMessage({
                      state: summary.state,
                      reports: report,
                      settings: settings.data,
                    }).title
                  }
                </h3>
                <p>
                  {
                    attendancePeriodMessage({
                      state: summary.state,
                      reports: report,
                      settings: settings.data,
                    }).detail
                  }
                </p>
              </div>
            )}
          </>
        )}
      </ResourceState>
      <Link className="admin-link" to="/attendance">
        View Attendance
        <ArrowUpRight aria-hidden="true" />
      </Link>
    </DashboardCard>
  );
}
function PayrollApprovals({ resource, month, allLink }) {
  const q = resource.data;
  const initials = (name) => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return [words[0], words.length > 1 ? words.at(-1) : null].filter(Boolean).map(word => Array.from(word)[0]).join('').toLocaleUpperCase() || '?';
  };
  return <section aria-label="Payroll Approvals" className="hr-card admin-payroll-card">
    <header className="admin-payroll-heading">
      <span className="admin-payroll-icon"><FileCheck aria-hidden="true" /></span>
      <div><h2>Payroll Approvals</h2><p className="admin-payroll-month">{monthLabel(q?.payrollMonth || month)}</p></div>
      {!resource.loading && !resource.error && q && <span className="admin-payroll-count">{q.payroll.total} pending</span>}
    </header>
    <ResourceState resource={resource} label="payroll approvals">
      {q && (q.payroll.items.length ? <ul className="admin-payroll-preview">
        {q.payroll.items.map(item => <li key={item.id}>
          <span className="admin-payroll-avatar" aria-hidden="true">{initials(item.employee.name)}</span>
          <div className="admin-payroll-employee">
            <strong>{item.employee.name}</strong>
            <p className="admin-payroll-code">{item.employee.code}</p>
            <p className={`admin-payroll-readiness${item.eligible ? '' : ' is-blocked'}`}>
              {item.eligible && <CheckCircle2 aria-hidden="true" />}
              {item.eligible ? 'Ready for final approval' : `Blocked: ${item.blockers.join('; ')}`}
            </p>
          </div>
          <div className="admin-payroll-row-actions">
            {item.status === 'HR_APPROVED' && <span className="admin-payroll-approved"><CheckCircle2 aria-hidden="true" />HR approved</span>}
            <Link className="admin-payroll-review" to={'/payroll?' + new URLSearchParams({month:q.payrollMonth,status:'HR_APPROVED',payrollId:item.id})}>
              Review<span className="sr-only"> payroll for {item.employee.name}</span><ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </li>)}
      </ul> : <p className="admin-state">No HR-approved payroll for this month.</p>)}
    </ResourceState>
    <footer className="admin-payroll-footer"><Link className="admin-link" to={allLink}>View all payroll<ArrowRight aria-hidden="true" /></Link></footer>
  </section>;
}

export default function AdminDashboard() {
  const { user, refreshSession } = useAuth(),
    [revision, setRevision] = useState(0),
    [month, setMonth] = useState(karachiMonth),
    [initialTime] = useState(() => new Date().toISOString()),
    failed = useRef(false);
  const onAuthFailure = useCallback(() => {
    if (!failed.current) {
      failed.current = true;
      void refreshSession();
    }
  }, [refreshSession]);
  const employees = useHrRead("/dashboard/employees", revision, onAuthFailure),
    rawQueues = useHrRead(
      "/dashboard/admin-queues?" + new URLSearchParams({ month }),
      revision,
      onAuthFailure,
    ),
    settings = useHrRead("/attendance-settings", revision, onAuthFailure),
    announcements = useHrRead(
      "/dashboard/announcements",
      revision,
      onAuthFailure,
    );
  const queues =
    rawQueues.data && !validAdminQueues(rawQueues.data)
      ? {
          ...rawQueues,
          data: null,
          error: new Error("Admin queue data could not be verified."),
        }
      : rawQueues;
  const anchor = employees.data?.dutyDate,
    report = useHrRead(
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
    );
  const attendance = employees.loading
    ? { ...report, loading: true }
    : employees.error
      ? { ...report, error: employees.error, retry: employees.retry }
      : settings.loading
        ? { ...report, loading: true }
        : settings.error
          ? { ...report, error: settings.error, retry: settings.retry }
          : report;
  const leave = employees.loading
    ? { ...report, loading: true }
    : employees.error
      ? { ...report, error: employees.error, retry: employees.retry }
      : report;
  const e = employees.data,
    q = queues.data,
    instant = e?.asOf || initialTime,
    pending = [employees, queues, settings, announcements, report].some(
      (r) => r.loading,
    ),
    payrollLink = (status) =>
      "/payroll?" + new URLSearchParams({ month, status });
  return (
    <div className="hr-dashboard admin-dashboard">
      <section aria-label="Admin welcome" className="hr-welcome">
        <div>
          <p className="hr-eyebrow">ORGANIZATION MANAGEMENT</p>
          <h1>
            {greeting(instant)}, {user.displayName}
          </h1>
          <p>Your people, approvals and organization at a glance.</p>
          <p>
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Karachi",
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(new Date(instant))}{" "}
            · Asia/Karachi
          </p>
        </div>
        <DashboardHeadset />
        <Button
          variant="outline"
          size="icon"
          className="hr-refresh"
          aria-label="Refresh dashboard"
          disabled={pending}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw
            aria-hidden="true"
            className={pending ? "animate-spin" : ""}
          />
        </Button>
      </section>
      <div className="hr-kpis">
        <KPI
          title="Total Employees"
          resource={employees}
          value={e?.totalProfiles}
        //   hint="All employee profiles"
          icon={UsersRound}
        />
        <KPI
          title="Active Employees"
          resource={employees}
          value={e?.eligibleEmployment}
        //   hint="Active, probation & notice period"
          icon={UserCheck}
        />
        <KPI
          title="On Leave"
          resource={leave}
          value={report.data?.totals.paidLeaveDays}
        //   hint={
        //     anchor
        //       ? `Approved · duty ${dateLabel(anchor, true)}`
        //       : "Approved duty-date leave"
        //   }
          icon={CalendarCheck}
          tone="hr-kpi-amber"
        />
        <KPI
          title="Exited Employees"
          resource={employees}
          value={e?.statuses.EXITED}
        //   hint={
        //     e
        //       ? `Ended latest employment · as of ${e.date}`
        //       : "Employees, not exit events"
        //   }
          icon={LogOut}
          tone="hr-kpi-red"
        />
      </div>
      <div className="admin-row">
        <DashboardCard
          title="Admin Work Queues"
          icon={ClipboardCheck}
          controls={
            <label className="admin-month">
              Payroll month
              <input
                aria-label="Payroll month"
                type="month"
                value={month}
                onChange={(event) => {
                  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value))
                    setMonth(event.target.value);
                }}
              />
            </label>
          }
        >
          <ResourceState resource={queues} label="admin work queues">
            {q && (
              <>
                <div className="hr-queues">
                  <Queue
                    label="Payroll Approvals"
                    count={q.payroll.eligible}
                    to={payrollLink("HR_APPROVED")}
                    icon={FileCheck}
                  />
                  <Queue
                    label="Pending Payments"
                    count={q.payments}
                    to={payrollLink("APPROVED")}
                    icon={Coins}
                  />
                  <Queue
                    label="Attendance Corrections"
                    count={q.corrections.reviewable}
                    to="/attendance?view=corrections&reviewableOnly=true"
                    icon={CalendarCheck}
                  />
                  <Queue
                    label="Employment Approvals"
                    count={q.employment.reviewable}
                    to="/employment?state=ADMIN_APPROVAL"
                    icon={UsersRound}
                  />
                </div>
                {/* <p className="admin-note">
                  Payroll: {q.payrollMonth}. Other queues: all dates. Links open
                  review screens; no action is performed here.
                </p>
                <p className="admin-note">
                  HR-approved overall: {q.payroll.total}. Blocked flags (may
                  overlap): same approver {q.payroll.blockedSameApprover},
                  salary {q.payroll.blockedStaleSalary}, revision limit{" "}
                  {q.payroll.blockedRevisionLimit}.
                </p>
                <p className="admin-note">
                  Approved awaiting payment overall: {q.paymentsOverall};
                  blocked at revision limit: {q.blockedPaymentsRevisionLimit}.
                  Corrections overall pending: {q.corrections.overall}.
                  Employment overall awaiting Admin: {q.employment.overall}.
                  Payroll/employment screens include blocked records for review.
                </p> */}
              </>
            )}
          </ResourceState>
        </DashboardCard>
        <Attendance resource={attendance} settings={settings} anchor={anchor} />
      </div>
      <div className="admin-row">
        <PayrollApprovals resource={queues} month={month} allLink={payrollLink("HR_APPROVED")} />
        <RecentAnnouncements resource={announcements} />
      </div>
    </div>
  );
}

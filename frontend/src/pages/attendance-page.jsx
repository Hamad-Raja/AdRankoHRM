import { Fragment, useState, useEffect, useCallback, useRef } from "react";
import {useSearchParams} from 'react-router';
import { useAuth } from "@/context/auth-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@/components/self-service-pages.css";
import { organization } from "@/services/organization.service";
import AttendanceClock from "@/components/attendance-clock";
import AttendanceHistory from "@/components/attendance-history";
import PaidLeaveAttendance from '@/components/paid-leave-attendance';
import {
  getAttendanceList,
  getDailySummary,
  listAllCorrections,
  reviewCorrection,
} from "@/services/attendance.service";
import {
  Users,
  CheckCircle2,
  Clock,
  LogOut,
  AlertCircle,
  Check,
  X,
  RefreshCw,
  Filter,
  RotateCcw,
} from "lucide-react";

export default function AttendancePage() {
  const [dashboardQuery]=useSearchParams();
  const { user, getCsrfToken, refreshSession } = useAuth();
  const isAdminOrHr = ["ADMIN", "HR"].includes(user?.role);
  const isManager = user?.role === "MANAGER";
  const RecordFilters = isManager ? "div" : Fragment;

  // Active view tab
  const [activeTab, setActiveTab] = useState(
    isAdminOrHr&&dashboardQuery.get('view')==='corrections' ? 'corrections' : isAdminOrHr ? "daily" : isManager ? "team" : "own"
  );

  // Trigger to sync widgets
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // ─── Daily Summary State (Admin/HR) ──────────────────────────────
  const [todayStr] = useState(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()));

  const [summaryDate, setSummaryDate] = useState(todayStr);
  const [dailySummary, setDailySummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const summaryRequest = useRef(0);

  const loadSummary = useCallback(async (date) => {
    if (!isAdminOrHr) return;
    const request = ++summaryRequest.current;
    setLoadingSummary(true);
    setDailySummary(null);
    setSummaryError("");
    try {
      const data = await getDailySummary(date);
      if (request !== summaryRequest.current) return;
      setDailySummary(data);
    } catch (err) {
      if (request !== summaryRequest.current) return;
      setSummaryError(err.message || "Failed to load daily attendance summary.");
      if (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
    } finally {
      if (request === summaryRequest.current) setLoadingSummary(false);
    }
  }, [isAdminOrHr, refreshSession]);

  useEffect(() => {
    if (isAdminOrHr && activeTab === "daily") {
      loadSummary(summaryDate);
    }
  }, [isAdminOrHr, activeTab, summaryDate, loadSummary, refreshTrigger]);

  // ─── All / Team Attendance List State ─────────────────────────────
  const [records, setRecords] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsTotalPages, setRecordsTotalPages] = useState(1);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const recordsRequest = useRef(0);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [units, setUnits] = useState([]);
  useEffect(() => {
    if (!isAdminOrHr) return;
    const controller = new AbortController();
    organization({ signal: controller.signal }).then(result => setUnits(result.units || [])).catch(err => { if (!controller.signal.aborted) setRecordsError(err.message); });
    return () => controller.abort();
  }, [isAdminOrHr]);

  const loadAttendanceRecords = useCallback(async () => {
    if (!isAdminOrHr && !isManager) return;
    const request = ++recordsRequest.current;
    setLoadingRecords(true);
    setRecords([]);
    setRecordsError("");
    try {
      const data = await getAttendanceList({
        page: recordsPage,
        pageSize: 20,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        status: filterStatus || undefined,
        search: search || undefined, departmentId: departmentId || undefined, campaignId: campaignId || undefined, teamId: teamId || undefined,
      });
      if (request !== recordsRequest.current) return;
      setRecords(data.records || []);
      setRecordsTotal(data.total || 0);
      setRecordsTotalPages(data.totalPages || 1);
    } catch (err) {
      if (request !== recordsRequest.current) return;
      setRecordsError(err.message || "Failed to load attendance list.");
      if (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
    } finally {
      if (request === recordsRequest.current) setLoadingRecords(false);
    }
  }, [isAdminOrHr, isManager, recordsPage, filterDateFrom, filterDateTo, filterStatus, search, departmentId, campaignId, teamId, refreshSession]);

  useEffect(() => {
    if ((isAdminOrHr && activeTab === "list") || (isManager && activeTab === "team")) {
      loadAttendanceRecords();
    }
  }, [isAdminOrHr, isManager, activeTab, loadAttendanceRecords, refreshTrigger]);

  // ─── Corrections Review Queue State (Admin/HR) ───────────────────
  const [corrections, setCorrections] = useState([]);
  const [correctionPage, setCorrectionPage] = useState(1);
  const [correctionPages, setCorrectionPages] = useState(1);
  const [correctionStatus, setCorrectionStatus] = useState('PENDING');
  const [reviewableOnly,setReviewableOnly] = useState(dashboardQuery.get('reviewableOnly') === 'true');
  const [loadingCorrections, setLoadingCorrections] = useState(false);
  const [correctionsError, setCorrectionsError] = useState("");
  const correctionsRequest = useRef(0);
  const [selectedCorrection, setSelectedCorrection] = useState(null);
  const [reviewDecision, setReviewDecision] = useState("APPROVED");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewDialogRef = useRef(null);

  const loadCorrections = useCallback(async () => {
    if (!isAdminOrHr) return;
    const request = ++correctionsRequest.current;
    setLoadingCorrections(true);
    setCorrections([]);
    setCorrectionsError("");
    try {
      const data = await listAllCorrections({
        page: correctionPage,
        pageSize: 50,
        status: correctionStatus || undefined,
        reviewableOnly: reviewableOnly ? 'true' : undefined,
      });
      if (request !== correctionsRequest.current) return;
      setCorrections(data.corrections || []);
      setCorrectionPages(Math.max(1, data.totalPages || 1));
      if (correctionPage > Math.max(1, data.totalPages || 1)) setCorrectionPage(Math.max(1, data.totalPages || 1));
    } catch (err) {
      if (request !== correctionsRequest.current) return;
      setCorrectionsError(err.message || "Failed to load correction requests.");
      if (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
    } finally {
      if (request === correctionsRequest.current) setLoadingCorrections(false);
    }
  }, [isAdminOrHr, correctionPage, correctionStatus, reviewableOnly, refreshSession]);

  useEffect(() => {
    if (isAdminOrHr && activeTab === "corrections") {
      loadCorrections();
    }
  }, [isAdminOrHr, activeTab, loadCorrections, refreshTrigger]);

  function openReviewDialog(c, decision) {
    if (!c.canReview) return;
    setSelectedCorrection(c);
    setReviewDecision(decision);
    setReviewReason(decision === "APPROVED" ? "Approved as requested." : "");
    setReviewError("");
    reviewDialogRef.current?.showModal();
  }

  async function handleReviewSubmit(e) {
    e.preventDefault();
    if (reviewing) return;
    if (!reviewReason.trim()) {
      setReviewError("A review reason is required.");
      return;
    }
    setReviewing(true);
    setReviewError("");

    try {
      const csrfToken = getCsrfToken();
      await reviewCorrection(
        selectedCorrection.id,
        {
          decision: reviewDecision,
          reviewReason: reviewReason.trim(),
          expectedVersion: selectedCorrection.version,
        },
        csrfToken
      );

      reviewDialogRef.current?.close();
      setSelectedCorrection(null);
      loadCorrections();
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setReviewError(err.message || "Failed to submit review decision.");
      if (err.status === 401 || err.code === "PASSWORD_CHANGE_REQUIRED") {
        void refreshSession();
      }
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className={isAdminOrHr ? "space-y-8" : "self-service-page attendance-workspace space-y-5"}>
      {isAdminOrHr && <PaidLeaveAttendance key={user.id}/>}
      {/* Page Title & Navigation Bar */}
      <div className={isAdminOrHr?"flex flex-wrap items-center justify-between gap-4":"self-service-page-header attendance-page-header"}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {isAdminOrHr
              ? "Attendance Management"
              : isManager
              ? "Attendance"
              : "My Attendance"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {isAdminOrHr
              ? "Monitor organization duty shifts, lateness, and review correction requests."
              : isManager
              ? "Track your team's overnight duty presence and clock your own attendance."
              : "Clock in and out, track duty history, and submit corrections."}
          </p>
        </div>

      {!isAdminOrHr && <details className="self-service-guide quiet-disclosure"><summary>Attendance guide</summary><div><p>Duty dates use the shift-start date. An overnight Friday duty belongs to Friday, including its Saturday morning hours.</p><p>Original punches and raw elapsed time are recorded facts. Approved corrections remain separate; neither is approved payable time or a payroll calculation.</p><p>Use My Clock &amp; Logs for your own punches and correction requests. Team attendance remains limited to your permitted team scope. Current restrictions and unresolved checkout warnings remain visible alongside the clock.</p></div></details>}

        {/* Tab switcher */}
        <div className={isAdminOrHr?"flex flex-wrap items-center gap-1 rounded-xl border border-border/80 p-1 bg-muted/40 shadow-inner":isManager?"manager-page-tabs attendance-view-tabs":"self-service-tabs attendance-view-tabs"}>
          {isAdminOrHr && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab("daily")}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === "daily"
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
              >
                Daily Summary
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("list")}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === "list"
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
              >
                All Records
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("corrections")}
                className={`relative rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === "corrections"
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
              >
                Corrections
                {corrections.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {corrections.length}
                  </span>
                )}
              </button>
            </>
          )}

          {isManager && (
            <button
              type="button"
              aria-pressed={activeTab === "team"}
              onClick={() => setActiveTab("team")}
              className={buttonVariants({ variant: activeTab === "team" ? "default" : "outline" })}
            >
              Team Attendance
            </button>
          )}

          <button
            type="button"
            aria-pressed={activeTab === "own"}
            onClick={() => setActiveTab("own")}
            className={isManager ? buttonVariants({ variant: activeTab === "own" ? "default" : "outline" }) : `rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "own"
                ? "bg-background text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            }`}
          >
            My Clock & Logs
          </button>
        </div>
      </div>


      {/* ─── TAB: Daily Summary (Admin/HR) ─────────────────────────── */}
      {isAdminOrHr && activeTab === "daily" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <label htmlFor="summary-date-input" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Shift Date:
              </label>
              <Input
                id="summary-date-input"
                type="date"
                value={summaryDate}
                onChange={(e) => setSummaryDate(e.target.value)}
                className="h-9 w-44 text-xs font-semibold"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadSummary(summaryDate)}
                disabled={loadingSummary}
                className="h-9 gap-1.5 text-xs font-semibold px-3.5"
              >
                <RefreshCw className={`size-3.5 ${loadingSummary ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anchor: 19:00 (Pakistan time) to 05:00 next day
            </p>
          </div>

          {summaryError && (
            <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-semibold text-destructive">
              {summaryError}
            </div>
          )}

          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 shadow-2xs hover:shadow-xs transition-shadow">
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Clock-Ins</dt>
                <Users className="size-4 text-primary/70" />
              </div>
              <dd className="mt-2 text-2xl font-black tracking-tight text-foreground font-mono">{dailySummary?.totalRecords ?? 'Unavailable'}</dd>
            </div>
            <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 shadow-2xs hover:shadow-xs transition-shadow">
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">On Time</dt>
                <CheckCircle2 className="size-4 text-emerald-500/70" />
              </div>
              <dd className="mt-2 text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 font-mono">
                {dailySummary?.onTime ?? 'Unavailable'}
              </dd>
            </div>
            <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 shadow-2xs hover:shadow-xs transition-shadow">
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Late (Past Grace)</dt>
                <Clock className="size-4 text-amber-500/70" />
              </div>
              <dd className="mt-2 text-2xl font-black tracking-tight text-amber-600 dark:text-amber-400 font-mono">
                {dailySummary?.late ?? 'Unavailable'}
              </dd>
            </div>
            <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 shadow-2xs hover:shadow-xs transition-shadow">
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Early Out</dt>
                <LogOut className="size-4 text-rose-500/70" />
              </div>
              <dd className="mt-2 text-2xl font-black tracking-tight text-rose-600 dark:text-rose-400 font-mono">
                {dailySummary?.earlyDeparture ?? 'Unavailable'}
              </dd>
            </div>
            <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 shadow-2xs hover:shadow-xs transition-shadow">
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Missing Out</dt>
                <AlertCircle className="size-4 text-destructive/70" />
              </div>
              <dd className="mt-2 text-2xl font-black tracking-tight text-destructive font-mono">
                {dailySummary?.missingCheckout ?? 'Unavailable'}
              </dd>
            </div>
            <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-background p-4 shadow-2xs hover:shadow-xs transition-shadow">
              <div className="flex items-center justify-between">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Completed</dt>
                <Check className="size-4 text-blue-500/70" />
              </div>
              <dd className="mt-2 text-2xl font-black tracking-tight text-blue-600 dark:text-blue-400 font-mono">
                {dailySummary?.completed ?? 'Unavailable'}
              </dd>
            </div>
          </div>

          {/* Daily Records Table */}
          <div className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <div className="border-b border-border/80 p-4 sm:p-5">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Daily Records for {summaryDate}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/80 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4">Clock In</th>
                    <th className="py-2.5 px-4">Clock Out</th>
                    <th className="py-2.5 px-4">Raw elapsed</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Lateness</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loadingSummary ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                        Loading daily summary...
                      </td>
                    </tr>
                  ) : !dailySummary?.records || dailySummary.records.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                        {summaryError ? 'Daily records unavailable. Refresh to retry.' : `No employees clocked in on ${summaryDate}.`}
                      </td>
                    </tr>
                  ) : (
                    dailySummary.records.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-semibold text-xs text-foreground">
                          <div>{r.employee?.fullName}</div>
                          <div className="text-[11px] text-muted-foreground font-mono font-normal">
                            {r.employee?.employeeCode}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">
                          {r.clockInAt
                            ? new Intl.DateTimeFormat("en-PK", {
                                timeZone: "Asia/Karachi",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              }).format(new Date(r.clockInAt))
                            : "—"}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">
                          {r.clockOutAt
                            ? new Intl.DateTimeFormat("en-PK", {
                                timeZone: "Asia/Karachi",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              }).format(new Date(r.clockOutAt))
                            : "No actual checkout"}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono font-medium">
                          {r.workedMinutes != null
                            ? `${Math.floor(r.workedMinutes / 60)}h ${r.workedMinutes % 60}m`
                            : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                              r.status === "COMPLETED"
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : r.status === "OPEN"
                                ? "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "border-border bg-muted/60 text-muted-foreground"
                            }`}
                          >
                            {r.status}
                          </span>
                          {r.approvedAdjustment && <p className="text-xs">Approved adjustment: {r.approvedAdjustment.clockInAt} to {r.approvedAdjustment.clockOutAt || "unresolved"}; {r.approvedAdjustment.minutes ?? "unresolved"} minutes (not payable).</p>}
                        </td>
                        <td className="py-3 px-4">
                          {r.isLate ? (
                            <span className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                              Late
                            </span>
                          ) : (
                            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              On Time
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB: All Records (Admin/HR) or Team Records (Manager) ── */}
      {isAdminOrHr && activeTab === 'daily' && dailySummary && <section aria-label="Daily classifications" className="rounded-xl border p-4 space-y-2">
        <h2 className="font-semibold">Daily classifications</h2>
        <p className="text-sm">No clock-in after ended eligible duty: {dailySummary.noClockIn || 0}. Future duties, holidays, weekly offs and ineligible dates are excluded.</p>
        <ul className="max-h-80 overflow-auto text-sm">{dailySummary.classifications?.map(c => <li key={c.employee.id}>{c.employee.fullName} ({c.employee.employeeCode}): {c.classification}</li>)}</ul>
      </section>}

      {((isAdminOrHr && activeTab === "list") || (isManager && activeTab === "team")) && (
        <div className="space-y-6">
          <RecordFilters {...(isManager?{className:"attendance-filter-panel"}:{})}>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs">Employee search<Input aria-label="Employee search" value={search} onChange={e => { setSearch(e.target.value); setRecordsPage(1); }} /></label>
            {isAdminOrHr && [['DEPARTMENT', departmentId, setDepartmentId], ['CAMPAIGN', campaignId, setCampaignId], ['TEAM', teamId, setTeamId]].map(([kind, value, setter]) => <label key={kind} className="text-xs">{kind}<select aria-label={kind + ' filter'} value={value} onChange={e => { setter(e.target.value); setRecordsPage(1); }} className="block rounded-lg border bg-background p-2"><option value="">All</option>{units.filter(u => u.kind === kind).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>)}
          </div>
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
            <div className="space-y-1">
              <label htmlFor="filter-from-date" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                From Shift Date
              </label>
              <Input
                id="filter-from-date"
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="h-9 w-40 text-xs font-semibold"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="filter-to-date" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                To Shift Date
              </label>
              <Input
                id="filter-to-date"
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="h-9 w-40 text-xs font-semibold"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="filter-status-select" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </label>
              <select
                id="filter-status-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background/80 px-3 text-xs font-semibold text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 shadow-2xs outline-none"
              >
                <option value="">All Statuses</option>
                <option value="OPEN">Open (Active)</option>
                <option value="COMPLETED">Completed</option>
                <option value="MISSING_CHECKOUT">Missing Checkout</option>
                <option value="CORRECTED">Corrected</option>
              </select>
            </div>
            <Button
              size="sm"
              variant={isManager?"default":"secondary"}
              onClick={() => {
                setRecordsPage(1);
                loadAttendanceRecords();
              }}
              className="h-9 gap-1.5 text-xs font-semibold px-4"
            >
              <Filter className="size-3.5" />
              <span>Apply Filter</span>
            </Button>
            {(filterDateFrom || filterDateTo || filterStatus) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilterDateFrom("");
                  setFilterDateTo("");
                  setFilterStatus("");
                  setRecordsPage(1);
                }}
                className="h-9 gap-1.5 text-xs font-semibold px-3 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
                <span>Clear</span>
              </Button>
            )}
          </div>

          </RecordFilters>

          {recordsError && (
            <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              {recordsError}
            </p>
          )}

          {!isManager&&<p className="text-xs text-muted-foreground">Original punches and raw elapsed minutes are recorded facts, not approved/payable time. Approved corrections remain separate.</p>}
          {/* Table */}
          <div className={isManager?"attendance-logs-card rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden":"rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden"}>
            {isManager&&<div className="self-service-card-heading"><h2>Attendance logs</h2></div>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/80 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4">Shift Date</th>
                    <th className="py-2.5 px-4">Clock In</th>
                    <th className="py-2.5 px-4">Clock Out</th>
                    <th className="py-2.5 px-4">Raw elapsed</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loadingRecords ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                        Loading attendance records...
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                        {recordsError ? 'Attendance records unavailable. Apply filters or refresh to retry.' : 'No records found matching filters.'}
                      </td>
                    </tr>
                  ) : (
                    records.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-semibold text-xs text-foreground">
                          <div>{r.employee?.fullName}</div>
                          <div className="text-[11px] text-muted-foreground font-mono font-normal">
                            {r.employee?.employeeCode}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-xs font-mono">{r.shiftDate}</td>
                        <td className="py-3 px-4 font-mono text-xs">
                          {r.clockInAt
                            ? new Intl.DateTimeFormat("en-PK", {
                                timeZone: "Asia/Karachi",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              }).format(new Date(r.clockInAt))
                            : "—"}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">
                          {r.clockOutAt
                            ? new Intl.DateTimeFormat("en-PK", {
                                timeZone: "Asia/Karachi",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              }).format(new Date(r.clockOutAt))
                            : "—"}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono font-medium">
                          {r.workedMinutes != null
                            ? `${Math.floor(r.workedMinutes / 60)}h ${r.workedMinutes % 60}m`
                            : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                              r.status === "COMPLETED"
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : r.status === "OPEN"
                                ? "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "border-border bg-muted/60 text-muted-foreground"
                            }`}
                          >
                            {r.status}
                          </span>
                          {r.approvedAdjustment && (isManager ? <details className="attendance-adjustment-details"><summary>Approved adjustment</summary><p>{r.approvedAdjustment.clockInAt} to {r.approvedAdjustment.clockOutAt || "unresolved"}; {r.approvedAdjustment.minutes ?? "unresolved"} minutes (not payable). Original punches remain unchanged.</p></details> : <p className="text-xs">Approved adjustment: {r.approvedAdjustment.clockInAt} to {r.approvedAdjustment.clockOutAt || "unresolved"}; {r.approvedAdjustment.minutes ?? "unresolved"} minutes (not payable).</p>)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1.5">
                            {r.isLate && (
                              <span className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                Late
                              </span>
                            )}
                            {r.isEarlyDeparture && (
                              <span className="rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                Early Out
                              </span>
                            )}
                            {r.isMissingCheckout && (
                              <span className="rounded-md border border-destructive/30 bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                                Missing Out
                              </span>
                            )}
                            {!r.isLate && !r.isEarlyDeparture && !r.isMissingCheckout && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {isManager&&<p className="attendance-evidence-note">Recorded elapsed time - Not payable hours. Approved corrections remain separate.</p>}

            {/* Pagination */}
            {!loadingRecords && !recordsError && recordsTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border/80 p-4">
                <p className="text-xs text-muted-foreground font-medium">
                  Page {recordsPage} of {recordsTotalPages} ({recordsTotal} total entries)
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={recordsPage <= 1}
                    onClick={() => setRecordsPage((p) => Math.max(1, p - 1))}
                    className="h-8 px-3 text-xs font-semibold"
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={recordsPage >= recordsTotalPages}
                    onClick={() => setRecordsPage((p) => Math.min(recordsTotalPages, p + 1))}
                    className="h-8 px-3 text-xs font-semibold"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: Pending Corrections Queue (Admin/HR only) ────────── */}
      {isAdminOrHr && activeTab === "corrections" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewableOnly} onChange={e=>{setReviewableOnly(e.target.checked);setCorrectionPage(1);}}/>Only pending corrections I can review</label>
            <label className="text-xs">Correction status<select aria-label="Correction status" className="ml-2 rounded border bg-background p-2" value={correctionStatus} onChange={e => { setCorrectionStatus(e.target.value); setCorrectionPage(1); }}><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All decisions</option></select></label>
            <Button variant="outline" disabled={loadingCorrections || correctionPage <= 1} onClick={() => setCorrectionPage(p => p - 1)}>Previous requests</Button>
            <span className="text-xs">Page {correctionPage} of {correctionPages}</span>
            <Button variant="outline" disabled={loadingCorrections || correctionPage >= correctionPages} onClick={() => setCorrectionPage(p => p + 1)}>Next requests</Button>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <div className="border-b border-border/80 p-4 sm:p-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">{correctionStatus === 'PENDING' ? 'Pending Correction Requests' : 'Correction decision history'}</h2>
                <p className="text-xs text-muted-foreground">
                  Review employee requests for missing checkouts or time adjustments.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadCorrections}
                disabled={loadingCorrections}
                className="h-9 gap-1.5 text-xs font-semibold px-3.5"
              >
                <RefreshCw className={`size-3.5 ${loadingCorrections ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </Button>
            </div>

            {correctionsError && (
              <p role="alert" className="p-4 text-xs font-semibold text-destructive">
                {correctionsError}
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border/80 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4">Shift Date</th>
                    <th className="py-2.5 px-4">Correction Type</th>
                    <th className="py-2.5 px-4">Requested Times</th>
                    <th className="py-2.5 px-4">Employee Reason</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loadingCorrections ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                        Loading pending requests...
                      </td>
                    </tr>
                  ) : corrections.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                        {correctionsError ? 'Correction requests unavailable. Refresh to retry.' : correctionStatus === 'PENDING' ? 'No pending correction requests.' : 'No correction requests match this status.'}
                      </td>
                    </tr>
                  ) : (
                    corrections.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-semibold text-xs text-foreground">
                          <div>{c.employee?.fullName}</div>
                          <div className="text-[11px] text-muted-foreground font-mono font-normal">
                            {c.employee?.employeeCode}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-xs font-mono">{c.shiftDate}</td>
                        <td className="py-3 px-4 text-xs font-medium">{c.requestType}</td>
                        <td className="py-3 px-4 text-xs font-mono">
                          {c.correctedClockIn && (
                            <div>In: {new Date(c.correctedClockIn).toLocaleTimeString([], { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })}</div>
                          )}
                          {c.correctedClockOut && (
                            <div>Out: {new Date(c.correctedClockOut).toLocaleTimeString([], { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })}</div>
                          )}
                          <p className="text-muted-foreground">Original evidence: {c.originalData?.clockInAt || 'no recorded entry'} to {c.originalData?.clockOutAt || 'no recorded exit'}. Proposed times above use Asia/Karachi.</p>
                        </td>
                        <td className="py-3 px-4 text-xs max-w-xs truncate" title={c.reason}>
                          {c.reason}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="ml-auto flex max-w-64 flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => openReviewDialog(c, "APPROVED")}
                              disabled={!c.canReview}
                              className="h-8 px-3 text-xs gap-1 font-semibold"
                            >
                              <Check className="size-3.5" />
                              <span>Approve</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openReviewDialog(c, "REJECTED")}
                              disabled={!c.canReview}
                              className="h-8 px-3 text-xs gap-1 font-semibold"
                            >
                              <X className="size-3.5" />
                              <span>Reject</span>
                            </Button>
                            {c.status === 'PENDING' && c.reviewBlockedReason && <p className="basis-full text-xs">{c.reviewBlockedReason}</p>}
                            {c.status !== 'PENDING' && <p className="text-xs">{c.status}: {c.reviewReason}. Reviewed {c.reviewedAt} by {c.reviewedBy?.displayName || 'authorized reviewer'}.</p>}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB: Own Attendance Clock & History ─────────────────────── */}
      {activeTab === "own" && (
        <div className="space-y-8">
          <AttendanceClock onRecordUpdated={() => setRefreshTrigger((v) => v + 1)} />
          <AttendanceHistory refreshTrigger={refreshTrigger} />
        </div>
      )}

      {!isAdminOrHr && <details className="self-service-guide paid-leave-disclosure"><summary>Approved paid leave</summary><PaidLeaveAttendance key={user.id}/></details>}

      {/* ─── Review Dialog Modal ────────────────────────────────────── */}
      <dialog
        ref={reviewDialogRef}
        aria-label={reviewDecision === 'APPROVED' ? 'Approve Correction' : 'Reject Correction'}
        onClose={() => setSelectedCorrection(null)}
        className="fixed inset-0 m-auto w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-card-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs"
      >
        <div className="flex items-center justify-between pb-3.5 border-b border-border/80">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {reviewDecision === "APPROVED" ? "Approve Correction" : "Reject Correction"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Confirm decision and log mandatory explanation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => reviewDialogRef.current?.close()}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring transition-colors"
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </button>
        </div>

        {selectedCorrection && (
          <form onSubmit={handleReviewSubmit} className="mt-4 space-y-4">
            {reviewError && (
              <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                {reviewError}
              </div>
            )}

            <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5 text-xs space-y-1.5">
              <p className="font-semibold text-foreground">
                Employee: {selectedCorrection.employee?.fullName} ({selectedCorrection.employee?.employeeCode})
              </p>
              <p className="text-muted-foreground">Shift Date: {selectedCorrection.shiftDate}</p>
              <p className="text-muted-foreground">Reason: {selectedCorrection.reason}</p>
            </div>

            <div className="space-y-1">
              <label htmlFor="review-reason-input" className="block text-xs font-semibold text-foreground">
                Review Decision Notes (Required)
              </label>
              <textarea
                id="review-reason-input"
                rows={3}
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                placeholder="Enter review decision explanation..."
                required
                className="w-full rounded-xl border border-input bg-background/80 p-3 text-xs font-medium text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 shadow-2xs outline-none resize-none transition-all"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-border/80">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => reviewDialogRef.current?.close()}
                disabled={reviewing}
                className="h-9 px-4 text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={reviewDecision === "APPROVED" ? "success" : "destructive"}
                disabled={reviewing}
                className="h-9 px-4 text-xs font-semibold"
              >
                {reviewing ? "Submitting..." : `Confirm ${reviewDecision}`}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

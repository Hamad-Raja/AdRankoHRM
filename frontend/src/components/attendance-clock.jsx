import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth-context";
import {
  getAttendanceStatus,
  getOwnHistory,
  clockIn,
  clockOut,
} from "@/services/attendance.service";
import AttendanceCorrectionModal from "./attendance-correction-modal";
import {
  Clock,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileEdit,
} from "lucide-react";

const pendingPunches = new Map();

export default function AttendanceClock({ onRecordUpdated }) {
  const { user, getCsrfToken, refreshSession } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const lockRef = useRef(false);
  const [pending, setPending] = useState(() => pendingPunches.get(user.id) || null);

  // Live clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadStatus = useCallback(
    async (signal) => {
      try {
        const res = await getAttendanceStatus({ signal });
        setData(res);
        const action = pendingPunches.get(user.id);
        if (action) {
          const history = await getOwnHistory({ dateFrom: action.shiftDate, dateTo: action.shiftDate }, { signal });
          const confirmed = history.records.some(r => (action.kind === 'in' ? r.clockInRequestId : r.clockOutRequestId) === action.requestId);
          if (confirmed) {
            pendingPunches.delete(user.id); setPending(null);
            setActionNotice('Pending punch confirmed from server history.');
          }
        }
        setError("");
      } catch (err) {
        if (!signal?.aborted) {
          setError(err.message || "Failed to load attendance status.");
          if (err.status === 401 || err.code === "PASSWORD_CHANGE_REQUIRED") {
            void refreshSession();
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [refreshSession, user.id]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    loadStatus(ctrl.signal);
    return () => ctrl.abort();
  }, [loadStatus]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadStatus(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loadStatus]);

  async function punch(kind) {
    if (lockRef.current || pendingPunches.has(user.id)) return;
    lockRef.current = true; setActionLoading(true); setError(''); setActionNotice('');
    const action = { kind, requestId: crypto.randomUUID(), attendanceRecordId: data?.attendance?.id, shiftDate: kind === 'out' ? data.attendance.shiftDate : data.schedule.shiftDate };
    pendingPunches.set(user.id, action); setPending(action);
    try {
      const record = kind === 'in' ? await clockIn(action.requestId, getCsrfToken()) : await clockOut(action.requestId, action.attendanceRecordId, getCsrfToken());
      pendingPunches.delete(user.id); setPending(null);
      setActionNotice(kind === 'in' ? 'Clock In confirmed by server.' : `Clock Out confirmed. Raw elapsed: ${record.workedMinutes} minutes; not approved/payable time.`);
      await loadStatus(); onRecordUpdated?.();
    } catch (err) {
      const uncertain = !err.status || err.status >= 500 || err.code === 'INVALID_RESPONSE';
      if (!uncertain) { pendingPunches.delete(user.id); setPending(null); setError(err.message); }
      else setError('Punch outcome is unconfirmed. Use Refresh Status to reconcile. No second punch will be sent. If still unconfirmed, contact HR with request ID ' + action.requestId);
      if (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
    } finally { lockRef.current = false; setActionLoading(false); }
  }
  const handleClockIn = () => punch('in');
  const handleClockOut = () => punch('out');

  // Format Pakistan time display
  const formattedTime = new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(currentTime);

  const formattedDate = new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(currentTime);

  const attendance = data?.attendance;
  const isClockedIn = attendance && ['OPEN', 'MISSING_CHECKOUT'].includes(attendance.status);

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Clock className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Attendance & Duty Clock
            </h2>
            <p className="text-xs text-muted-foreground">
              Official Shift: 19:00 → 05:00 next day (Asia/Karachi)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadStatus()}
            disabled={loading || actionLoading}
            title="Refresh status"
            aria-label="Refresh attendance status"
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCorrectionModal(true)}
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <FileEdit className="size-3.5" />
            <span>Request Correction</span>
          </Button>
        </div>
      </div>

      {/* Clock display */}
      <div className="my-6 relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-b from-primary/5 via-muted/20 to-background/50 py-7 px-4 text-center shadow-inner">
        <p className="text-4xl font-black tracking-tight sm:text-5xl font-mono text-foreground">
          {formattedTime}
        </p>
        <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {formattedDate} · Asia/Karachi (PKT)
        </p>

        {/* Current status pill */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {isClockedIn ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shadow-2xs">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Clocked In (Unresolved Session)
            </span>
          ) : attendance?.status === "COMPLETED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 shadow-2xs">
              <CheckCircle2 className="size-3.5" />
              Duty Completed Today
            </span>
          ) : data?.state === "WEEKLY_OFF" ? (
            <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              Weekly Off Day
            </span>
          ) : data?.state === "HOLIDAY" ? (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              Company Holiday
            </span>
          ) : data?.state === "PROFILE_LINK_REQUIRED" ? (
            <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive">
              Employee Profile Not Linked
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              Not Clocked In
            </span>
          )}

          {attendance?.isLate && (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              Late (Past Grace)
            </span>
          )}
          {attendance?.isEarlyDeparture && (
            <span className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
              Early Departure
            </span>
          )}
        </div>
      </div>

      {data?.state === 'SETUP_REQUIRED' && <p role="status" className="mb-4 text-sm">Attendance setup is required. Clock In stays unavailable until Admin/HR approves an effective schedule. An existing open session can still be checked out.</p>}
      {data?.approvedException && <p role="status" className="mb-4 text-sm">This duty has an approved exception with no original punches. See My Requests for the proposed times and HR decision.</p>}
      {data?.approvedLeave&&<p role="status" className="mb-4 rounded-lg border p-3 text-sm">Approved full-day paid leave on {data.approvedLeave.shiftDate}. Clock In is unavailable. No attendance punches were created; payroll remains manual.</p>}
      {/* Action feedback */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-semibold text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {pending && <p role="status" className="mb-4 text-sm">Awaiting confirmation for {pending.kind === 'in' ? 'Clock In' : 'Clock Out'}. Request: {pending.requestId}. Refresh Status checks history without sending another punch.</p>}
      {attendance?.isMissingCheckout && <p role="alert" className="mb-4 text-sm">Missing checkout: scheduled duty ended. Clock out with actual time or request HR correction.</p>}
      {attendance?.isAfterScheduleEnd && <p className="mb-4 text-sm">Checkout after scheduled end requires review.</p>}
      {attendance?.approvedAdjustment && <p className="mb-4 text-sm">Approved correction: {attendance.approvedAdjustment.clockInAt} to {attendance.approvedAdjustment.clockOutAt || 'unresolved'}. Original punches below are preserved. Adjusted minutes: {attendance.approvedAdjustment.minutes ?? 'unresolved'}; not payable time.</p>}
      {/* Attendance session details */}
      {attendance && (
        <div className="mb-6 rounded-xl border border-border/80 bg-background/80 p-4 text-xs">
          <h3 className="font-semibold text-foreground tracking-tight text-sm">
            Session Details — {attendance.shiftDate}
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-card p-2.5 border border-border/60">
              <dt className="text-[11px] font-medium text-muted-foreground">Clock In</dt>
              <dd className="mt-1 font-semibold text-foreground font-mono">
                {attendance.clockInAt
                  ? new Intl.DateTimeFormat("en-PK", {
                      timeZone: "Asia/Karachi",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    }).format(new Date(attendance.clockInAt))
                  : "—"}
              </dd>
            </div>
            <div className="rounded-lg bg-card p-2.5 border border-border/60">
              <dt className="text-[11px] font-medium text-muted-foreground">Clock Out</dt>
              <dd className="mt-1 font-semibold text-foreground font-mono">
                {attendance.clockOutAt
                  ? new Intl.DateTimeFormat("en-PK", {
                      timeZone: "Asia/Karachi",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    }).format(new Date(attendance.clockOutAt))
                  : "No actual checkout"}
              </dd>
            </div>
            <div className="rounded-lg bg-card p-2.5 border border-border/60">
              <dt className="text-[11px] font-medium text-muted-foreground">Raw Elapsed (not payable)</dt>
              <dd className="mt-1 font-semibold text-foreground font-mono">
                {attendance.workedMinutes != null
                  ? `${Math.floor(attendance.workedMinutes / 60)}h ${attendance.workedMinutes % 60}m`
                  : isClockedIn && data.asOf ? `${Math.max(0, Math.floor((Date.parse(data.asOf) - Date.parse(attendance.clockInAt)) / 60000))} minutes unresolved as of last server refresh` : "No actual checkout recorded"}
              </dd>
            </div>
            <div className="rounded-lg bg-card p-2.5 border border-border/60">
              <dt className="text-[11px] font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 font-semibold text-foreground">
                {attendance.status}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        {isClockedIn ? (
          <Button
            size="lg"
            variant="destructive"
            onClick={handleClockOut}
            disabled={!!pending || actionLoading || !data?.canClockOut}
            className="h-10 px-6 gap-2 text-sm font-semibold shadow-md shadow-destructive/20 hover:shadow-lg hover:shadow-destructive/30"
          >
            <LogOut className="size-4" />
            {actionLoading ? "Processing..." : "Clock Out"}
          </Button>
        ) : (
          <div className="flex flex-col gap-1.5 flex-1 sm:flex-initial">
            <Button
              size="lg"
              onClick={handleClockIn}
              disabled={!!pending || actionLoading || !data?.canClockIn}
              className="h-10 px-6 gap-2 text-sm font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30"
            >
              <LogIn className="size-4" />
              {actionLoading ? "Processing..." : "Clock In"}
            </Button>
            {!data?.canClockIn && data?.clockInBlockReason && (
              <p className="text-xs text-muted-foreground mt-1">
                {data.clockInBlockReason === "BEFORE_DUTY_START"
                  ? "Clock-in opens at 19:00 (Pakistan time)."
                  : data.clockInBlockReason === "AFTER_DUTY_END"
                  ? "Duty ended at 05:00. Request a correction for missed attendance."
                  : data.clockInBlockReason === "ALREADY_CLOCKED"
                  ? "Duty already completed for this shift date."
                  : data.clockInBlockReason === "OPEN_SESSION_EXISTS"
                  ? "Open attendance session already active."
                  : data.clockInBlockReason === "WEEKLY_OFF"
                  ? "Today is a scheduled weekly off."
                  : data.clockInBlockReason === "HOLIDAY"
                  ? "Today is an approved company holiday."
                  : "Clock in is currently unavailable."}
              </p>
            )}
          </div>
        )}
      </div>

      <AttendanceCorrectionModal
        isOpen={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
        initialRecord={attendance}
        initialShiftDate={data?.schedule?.shiftDate}
        onSubmitted={() => {
          loadStatus();
          onRecordUpdated?.();
        }}
      />
    </div>
  );
}

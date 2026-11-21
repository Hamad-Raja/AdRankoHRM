import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";
import { submitCorrectionRequest } from "@/services/attendance.service";
import { X, AlertCircle } from "lucide-react";

export default function AttendanceCorrectionModal(props){
  return props.isOpen?<CorrectionDialog key={`${props.initialRecord?.id||'missing'}:${props.initialShiftDate||''}`} {...props}/>:null;
}
function CorrectionDialog({
  isOpen,
  onClose,
  initialRecord = null,
  initialShiftDate = "",
  onSubmitted,
}) {
  const dialogRef = useRef(null);
  const closeTimer = useRef(null);
  const { getCsrfToken, refreshSession } = useAuth();
  const [shiftDate, setShiftDate] = useState(initialRecord?.shiftDate || initialShiftDate || "");
  const [requestType, setRequestType] = useState(initialRecord&&(initialRecord.status==='OPEN'||initialRecord.isMissingCheckout)?"MISSING_CHECKOUT":"WRONG_TIME");
  const [clockIn, setClockIn] = useState(()=>initialRecord?.clockInAt?new Date(Date.parse(initialRecord.clockInAt)+5*3600000).toISOString().slice(0,16):'');
  const [clockOut, setClockOut] = useState(()=>initialRecord?.clockOutAt?new Date(Date.parse(initialRecord.clockOutAt)+5*3600000).toISOString().slice(0,16):'');
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submitLock=useRef(false);
  useEffect(()=>{
    const dialog=dialogRef.current;
    if(isOpen)dialog?.showModal();
    // Removing this keyed dialog closes it. Calling close() during Strict Mode
    // effect replay would emit onClose and immediately dismiss a new dialog.
    return()=>clearTimeout(closeTimer.current);
  },[isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting||submitLock.current) return;
    if (!shiftDate) {
      setError("Shift date is required.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required explaining the correction.");
      return;
    }

    submitLock.current=true;
    setSubmitting(true);
    setError("");

    try {
      const csrfToken = getCsrfToken();
      await submitCorrectionRequest(
        {
          attendanceRecordId: initialRecord?.id || null,
          shiftDate,
          requestType,
          correctedClockIn: clockIn ? new Date(clockIn + ":00+05:00").toISOString() : null,
          correctedClockOut: clockOut ? new Date(clockOut + ":00+05:00").toISOString() : null,
          reason: reason.trim(),
        },
        csrfToken
      );

      setSuccess(true);
      closeTimer.current = setTimeout(() => {
        onSubmitted?.();
        onClose();
      }, 1200);
    } catch (err) {
      setError(err.message || "Failed to submit correction request.");
      if (err.status === 401 || err.code === "PASSWORD_CHANGE_REQUIRED") {
        void refreshSession();
      }
    } finally {
      submitLock.current=false;
      setSubmitting(false);
    }
  }

  return (
    <dialog aria-label="Request Attendance Correction"
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 m-auto w-full max-w-lg rounded-2xl border border-border/80 bg-card p-6 text-card-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs"
    >
      <div className="flex items-center justify-between pb-4 border-b border-border/80">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Request Attendance Correction
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Submit adjustments for missing checkouts or recorded time errors.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring transition-colors"
          aria-label="Close dialog"
        >
          <X className="size-4" />
        </button>
      </div>

      {success ? (
        <div className="py-8 text-center space-y-2">
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            Correction request submitted successfully!
          </p>
          <p className="text-xs text-muted-foreground">
            Your request is saved for HR review.
          </p>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <p className="text-xs text-muted-foreground">Proposed correction times use Asia/Karachi (UTC+05:00). They do not replace original server punches.</p>
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-foreground">
              Duty Shift Date (YYYY-MM-DD)
            </label>
            <Input
              aria-label="Shift date" type="date"
              value={shiftDate}
              onChange={(e) => setShiftDate(e.target.value)}
              required
              disabled={!!initialRecord}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-foreground">
              Correction Reason Type
            </label>
            <select
              aria-label="Correction type" value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              className="w-full h-9 rounded-lg border border-input bg-background/80 px-3 text-sm font-normal text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 shadow-2xs outline-none"
            >
              <option value="MISSING_CHECKOUT">Missing Checkout / Clock Out</option>
              <option value="WRONG_TIME">Incorrect Clock In / Out Time</option>
              <option value="OTHER">Other Reason</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground">
                Corrected Clock-In
              </label>
              <Input
                aria-label="Proposed Clock In (Asia/Karachi)" type="datetime-local"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground">
                Corrected Clock-Out
              </label>
              <Input
                aria-label="Proposed Clock Out (Asia/Karachi)" type="datetime-local"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-foreground">
              Explanation & Reason (Required)
            </label>
            <textarea
              aria-label="Correction reason" rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this correction is needed..."
              required
              className="w-full rounded-xl border border-input bg-background/80 p-3 text-sm font-medium text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 shadow-2xs outline-none resize-none transition-all"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-border/80">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={submitting}
              className="h-9 px-4 text-sm font-semibold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="h-9 px-4 text-sm font-semibold"
            >
              {submitting ? "Submitting..." : "Submit Correction Request"}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

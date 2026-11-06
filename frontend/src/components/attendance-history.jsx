import { useState, useEffect, useCallback, useRef, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getOwnHistory,
  listOwnCorrections,
} from "@/services/attendance.service";
import AttendanceCorrectionModal from "./attendance-correction-modal";
import { Filter, History, RotateCcw } from "lucide-react";

export default function AttendanceHistory({ refreshTrigger = 0 }) {
  const fieldId = useId();
  const [tab, setTab] = useState("records"); // 'records' | 'corrections'
  const [records, setRecords] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const requestSequence = useRef(0);

  const loadData = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setRecords([]);
    setCorrections([]);
    setError("");
    try {
      if (tab === "records") {
        const res = await getOwnHistory({
          page,
          pageSize: 15,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        if (request !== requestSequence.current) return;
        setRecords(res.records || []);
        setTotalPages(res.totalPages || 1);
      } else {
        const res = await listOwnCorrections({
          page,
          pageSize: 15,
        });
        if (request !== requestSequence.current) return;
        setCorrections(res.corrections || []);
        setTotalPages(res.totalPages || 1);
      }
    } catch (err) {
      if (request !== requestSequence.current) return;
      setError(err.message || "Failed to load attendance history.");
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [tab, page, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  function handleFilterSubmit(e) {
    e.preventDefault();
    setPage(1);
    loadData();
  }

  function handleResetFilter() {
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <History className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              My Attendance Records & Requests
            </h2>
            <p className="text-xs text-muted-foreground">
              Review personal attendance logs and check status of submitted corrections.
            </p>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex rounded-lg border border-border/80 p-1 bg-muted/40 shadow-inner">
          <button
            type="button"
            onClick={() => {
              setTab("records");
              setPage(1);
            }}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              tab === "records"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Attendance Logs
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("corrections");
              setPage(1);
            }}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              tab === "corrections"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Correction Requests
          </button>
        </div>
      </div>

      {/* Date filter for records */}
      {tab === "records" && (
        <form
          onSubmit={handleFilterSubmit}
          className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5"
        >
          <div className="space-y-1">
            <label htmlFor={`${fieldId}-from`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              From Date
            </label>
            <Input
              id={`${fieldId}-from`} type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-40 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${fieldId}-to`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              To Date
            </label>
            <Input
              id={`${fieldId}-to`} type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-40 text-xs"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" className="h-9 gap-1.5 text-xs font-semibold px-3.5">
            <Filter className="size-3.5" />
            <span>Apply</span>
          </Button>
          {(dateFrom || dateTo) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleResetFilter}
              className="h-9 gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}

      {/* Records table */}
      {tab === "records" ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/80 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">Duty Shift Date</th>
                <th className="py-2.5 px-3.5">Clock In</th>
                <th className="py-2.5 px-3.5">Clock Out</th>
                <th className="py-2.5 px-3.5">Raw elapsed (not payable)</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5">Flags</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                    Loading records...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                    {error ? 'Attendance history unavailable. Apply filters or reload to retry.' : 'No attendance records found.'}
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-3.5 font-semibold text-foreground text-xs">{r.shiftDate}</td>
                    <td className="py-3 px-3.5 font-mono text-xs">
                      {r.clockInAt
                        ? new Intl.DateTimeFormat("en-PK", {
                            timeZone: "Asia/Karachi",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          }).format(new Date(r.clockInAt))
                        : "—"}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-xs">
                      {r.clockOutAt
                        ? new Intl.DateTimeFormat("en-PK", {
                            timeZone: "Asia/Karachi",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          }).format(new Date(r.clockOutAt))
                        : "—"}
                    </td>
                    <td className="py-3 px-3.5 text-xs font-mono font-medium">
                      {r.workedMinutes != null
                        ? `${Math.floor(r.workedMinutes / 60)}h ${r.workedMinutes % 60}m`
                        : "—"}
                    </td>
                    <td className="py-3 px-3.5">
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
                      {r.approvedAdjustment && <p className="text-xs">Approved adjustment: {r.approvedAdjustment.clockInAt} to {r.approvedAdjustment.clockOutAt || "unresolved"}; {r.approvedAdjustment.minutes ?? "unresolved"} minutes.</p>}
                    </td>
                    <td className="py-3 px-3.5">
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
                    <td className="py-3 px-3.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedRecord(r);
                          setShowCorrectionModal(true);
                        }}
                        className="h-7 px-2.5 text-xs font-semibold"
                      >
                        Correct
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Corrections table */
        <div className="mt-4 overflow-x-auto rounded-xl border border-border/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/80 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">Shift Date</th>
                <th className="py-2.5 px-3.5">Type</th>
                <th className="py-2.5 px-3.5">Requested Correction</th>
                <th className="py-2.5 px-3.5">Reason</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5">Review Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    Loading requests...
                  </td>
                </tr>
              ) : corrections.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    {error ? 'Correction history unavailable. Reload to retry.' : 'No correction requests submitted.'}
                  </td>
                </tr>
              ) : (
                corrections.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-3.5 font-semibold text-foreground text-xs">{c.shiftDate}</td>
                    <td className="py-3 px-3.5 text-xs font-medium">{c.requestType}</td>
                    <td className="py-3 px-3.5 text-xs font-mono">
                      {c.correctedClockIn && (
                        <div>In: {new Date(c.correctedClockIn).toLocaleTimeString([], { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })}</div>
                      )}
                      {c.correctedClockOut && (
                        <div>Out: {new Date(c.correctedClockOut).toLocaleTimeString([], { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })}</div>
                      )}
                      {!c.correctedClockIn && !c.correctedClockOut && "—"}
                    </td>
                    <td className="py-3 px-3.5 text-xs max-w-xs truncate" title={c.reason}>
                      {c.reason}
                    </td>
                    <td className="py-3 px-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                          c.status === "APPROVED"
                            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : c.status === "REJECTED"
                            ? "border-destructive/30 bg-destructive/15 text-destructive"
                            : "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-xs text-muted-foreground">
                      {c.reviewReason || "Pending review"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t border-border/80 pt-3">
          <p className="text-xs text-muted-foreground font-medium">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 px-3 text-xs font-semibold"
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 px-3 text-xs font-semibold"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <AttendanceCorrectionModal
        isOpen={showCorrectionModal}
        onClose={() => {
          setShowCorrectionModal(false);
          setSelectedRecord(null);
        }}
        initialRecord={selectedRecord}
        onSubmitted={() => {
          loadData();
        }}
      />
    </div>
  );
}

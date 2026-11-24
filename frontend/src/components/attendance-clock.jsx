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
import {dutyPresentation,dutyTime,nextDay,attendanceDate,attendanceInstant,attendanceStatus,attendanceDuration} from '@/lib/attendance-clock-presentation';
import AttendanceClockCompact from "./attendance-clock-compact";
import {
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  FileEdit,
} from "lucide-react";

const pendingPunches = new Map();

export default function AttendanceClock(props) {
  const {user}=useAuth();
  return <AttendanceClockSession key={user.id} {...props}/>;
}
function AttendanceClockSession({ onRecordUpdated, presentation = "default", scheduleResource, refreshKey = 0 }) {
  const { user, getCsrfToken, refreshSession } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const lockRef = useRef(false);
  const [readAt,setReadAt] = useState(null);
  const [pending, setPending] = useState(() => pendingPunches.get(user.id) || null);

  const onRecordUpdatedRef = useRef(onRecordUpdated);
  useEffect(() => { onRecordUpdatedRef.current = onRecordUpdated; }, [onRecordUpdated]);
  const notifyUpdated = useCallback(() => { try { onRecordUpdatedRef.current?.(); } catch { setError("Attendance saved; overview refresh unavailable. Refresh the overview to retry."); } }, []);

  // Live clock tick
  useEffect(() => {
    if (presentation === "compact") return;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [presentation]);

  const readState=useRef({pending:null,controller:null});
  const loadStatus=useCallback((signal)=>{
    const state=readState.current;
    if(state.pending&&!state.controller.signal.aborted)return state.pending;
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)controller.abort();
    state.controller=controller;
    setLoading(true);
    const pending=(async()=>{
      try{
        const res=await getAttendanceStatus({signal:controller.signal});
        if(controller.signal.aborted)return;
        setReadAt(Date.now());setData(res);
        const action=pendingPunches.get(user.id);
        if(action){
          const history=await getOwnHistory({dateFrom:action.shiftDate,dateTo:action.shiftDate},{signal:controller.signal});
          if(controller.signal.aborted)return;
          if(history.records.some(r=>(action.kind==='in'?r.clockInRequestId:r.clockOutRequestId)===action.requestId)){
            pendingPunches.delete(user.id);setPending(null);setActionNotice('Pending punch confirmed from server history.');notifyUpdated();
          }
        }
        setError('');
        return res;
      }catch(err){if(!controller.signal.aborted){setError(err.message||'Failed to load attendance status.');if(err.status===401||err.code==='PASSWORD_CHANGE_REQUIRED')void refreshSession();}}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })().finally(()=>{signal?.removeEventListener('abort',abort);if(state.pending===pending)state.pending=null;});
    state.pending=pending;return pending;
  },[refreshSession,user.id,notifyUpdated]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadStatus(ctrl.signal);
    const state=readState.current;
    return () => {ctrl.abort();state.controller?.abort();};
  }, [loadStatus,refreshKey]);

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
      try {
        await (kind === 'in' ? clockIn(action.requestId, getCsrfToken()) : clockOut(action.requestId, action.attendanceRecordId, getCsrfToken()));
      } catch (err) {
        const uncertain = !err.status || err.status >= 500 || err.code === 'INVALID_RESPONSE';
        if (!uncertain) { pendingPunches.delete(user.id); setPending(null); setError(err.message); }
        else setError('Punch outcome is unconfirmed. Use Refresh Status to reconcile. No second punch will be sent. If still unconfirmed, contact HR with request ID ' + action.requestId);
        if (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
        return;
      }
      pendingPunches.delete(user.id); setPending(null);
      setActionNotice(kind === 'in' ? 'Clock In recorded.' : 'Clock Out recorded.');
      // A pre-punch read must never overwrite the confirmed write with stale status.
      readState.current.controller?.abort();
      const refreshed = await loadStatus();
      notifyUpdated();
      if (!refreshed) setError('Punch saved successfully, but attendance status could not be refreshed. Use Refresh Status to load the latest state.');
    } finally { lockRef.current = false; setActionLoading(false); }
  }
  const handleClockIn = () => punch('in');
  const handleClockOut = () => punch('out');

  const view=dutyPresentation(data,scheduleResource?.data,scheduleResource?.settings);
  const zone=view.schedule?.timeZone||'Asia/Karachi';
  const observedNow=data?.asOf?new Date(Date.parse(data.asOf)+Math.max(0,+currentTime-(readAt??+currentTime))):null;
  // Display time in the recorded/assigned schedule timezone.
  const formattedTime = new Intl.DateTimeFormat("en-PK", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(currentTime);

  const formattedDate = new Intl.DateTimeFormat("en-PK", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(currentTime);

  const attendance = data?.attendance;
  const isClockedIn = attendance && ['OPEN', 'MISSING_CHECKOUT'].includes(attendance.status);

  if (presentation === 'compact') return <AttendanceClockCompact data={data} loading={loading} actionLoading={actionLoading} error={error} notice={actionNotice} pending={pending} scheduleResource={scheduleResource} onRefresh={() => loadStatus()} onClockIn={handleClockIn} onClockOut={handleClockOut}/>;


  const state=attendance?attendanceStatus(attendance,observedNow):null;
  const unavailable=loading||!!error||actionLoading||!!pending;
  return <section aria-label="Attendance & Duty Clock" className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Clock aria-hidden="true" className="size-5 text-primary"/>Attendance & Duty Clock</h2><p className="mt-1 text-sm text-muted-foreground">{view.schedule?.startsAt&&view.schedule?.endsAt?<>{dutyTime(view.schedule.startsAt,zone)} &ndash; {dutyTime(view.schedule.endsAt,zone)}{nextDay({...view.schedule,timeZone:zone})?' (next day)':''} &middot; {zone}</>:view.actual}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" aria-label="Refresh attendance status" title="Refresh status" disabled={loading||actionLoading} onClick={()=>loadStatus()}><RefreshCw aria-hidden="true" className={loading?'size-4 animate-spin':'size-4'}/>Refresh</Button><Button variant="outline" size="sm" disabled={actionLoading} onClick={()=>setShowCorrectionModal(true)}><FileEdit aria-hidden="true" className="size-4"/>Request Correction</Button></div></header>
    <div className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="text-3xl font-semibold tracking-tight tabular-nums">{formattedTime}</p><p className="mt-1 text-sm text-muted-foreground">{formattedDate}</p><div className="mt-2 flex flex-wrap gap-2"><span className={state?.className||'rounded-full border bg-muted px-2.5 py-1 text-xs'}>{loading?'Loading status':error?'Status unavailable':state?.label||view.actual}</span>{attendance?.isLate&&<span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">Late</span>}{attendance?.isEarlyDeparture&&<span className="rounded-full border border-destructive/30 px-2.5 py-1 text-xs text-destructive">Early Clock-Out</span>}</div></div>
    {data?.canClockOut||isClockedIn?<Button className="h-11 gap-2 px-6" variant="destructive" disabled={unavailable||!data?.canClockOut} onClick={handleClockOut}><LogOut aria-hidden="true" className="size-4"/>{actionLoading?'Processing...':'Clock Out'}</Button>:<Button className="h-11 gap-2 px-6" disabled={unavailable||!data?.canClockIn} onClick={handleClockIn}><LogIn aria-hidden="true" className="size-4"/>{actionLoading?'Processing...':'Clock In'}</Button>}
    </div>
    <dl aria-label="Current Duty" className="grid grid-cols-2 gap-3 border-t border-border/80 pt-3 text-sm sm:grid-cols-4">{[['Duty Date',attendanceDate(attendance?.shiftDate||view.schedule?.date)],['Clock In',attendance?.clockInAt?dutyTime(attendance.clockInAt,zone):'—'],['Clock Out',attendance?.clockOutAt?attendanceInstant(attendance.clockOutAt,zone):'—'],['Duty Duration',attendanceDuration(attendance,data?.asOf,observedNow)]].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
    {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{actionNotice&&<p role="status" className="mt-3 text-sm text-primary">{actionNotice}</p>}
    {pending&&<p role="status" className="mt-3 text-sm">Punch outcome awaiting confirmation. Refresh status before another action. Request: {pending.requestId}.</p>}
    {!loading&&!error&&(!data?.canClockIn&&!data?.canClockOut||['SETUP_REQUIRED','PROFILE_LINK_REQUIRED','PAID_LEAVE'].includes(data?.state))&&<p role="status" className="mt-3 text-sm text-muted-foreground">{view.explanation}</p>}
    {state?.label==='Missing Clock-Out'&&<p role="alert" className="mt-3 text-sm text-destructive">Scheduled duty ended without a clock-out. Clock out if available or request a correction.</p>}
    {attendance?.isAfterScheduleEnd&&<p className="mt-3 text-sm">Checkout after scheduled end requires review.</p>}
    {data?.approvedException&&<p className="mt-3 text-sm">Approved attendance exception. Original punches were not created.</p>}
    {attendance?.approvedAdjustment&&<details className="mt-3 text-sm"><summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">Approved correction details</summary><p>{attendanceInstant(attendance.approvedAdjustment.clockInAt,zone)} to {attendanceInstant(attendance.approvedAdjustment.clockOutAt,zone)}; approved interval: {attendance.approvedAdjustment.minutes??'unresolved'} minutes. Original punches are preserved; this is not payable time.</p></details>}
    <AttendanceCorrectionModal isOpen={showCorrectionModal} onClose={()=>setShowCorrectionModal(false)} initialRecord={attendance} initialShiftDate={data?.schedule?.shiftDate} onSubmitted={()=>{loadStatus();notifyUpdated();}}/>
  </section>;
}

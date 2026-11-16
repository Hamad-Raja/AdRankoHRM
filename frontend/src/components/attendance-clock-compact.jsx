import {Link} from 'react-router';
import {CalendarDays,LogIn,LogOut,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {dutyPresentation,attendanceInstant,dutyTime,nextDay} from '@/lib/attendance-clock-presentation';
import './attendance-clock-compact.css';
function dutyDate(value,zone){
 if(!value||!Number.isFinite(Date.parse(value)))return 'Date unavailable';
 return new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
}
export default function AttendanceClockCompact({data,loading,actionLoading,error,notice,pending,scheduleResource,onRefresh,onClockIn,onClockOut}){
 const {schedule,actual,explanation,record,nextDuty}=dutyPresentation(data,scheduleResource?.data,scheduleResource?.settings);
 const blocked=loading||actionLoading||!!pending||!!error,zone=schedule?.timeZone||'Asia/Karachi';
 const overnight=schedule&&nextDay({...schedule,timeZone:zone});
 const completed=['COMPLETED','CORRECTED'].includes(record?.status);
 const exceptional=['SETUP_REQUIRED','PROFILE_LINK_REQUIRED','WEEKLY_OFF','HOLIDAY','PAID_LEAVE'].includes(data?.state)
  || ['LEGACY_ASSIGNMENT','NOT_ELIGIBLE','APPROVED_PAID_LEAVE','APPROVED_EXCEPTION'].includes(data?.clockInBlockReason)
  || ['LEGACY_ASSIGNMENT_REVIEW','NOT_ELIGIBLE'].includes(scheduleResource?.data?.state);
 const showRestriction=explanation&&(exceptional||(!data?.canClockIn&&!data?.canClockOut&&!completed));
 const status=loading?'Loading status':error?'Status unavailable':data?actual:'Status unavailable';
 const tone=record?.isMissingCheckout||record?.status==='MISSING_CHECKOUT'?'warning':data?.canClockOut?'checked-in':completed?'completed':exceptional?'warning':'neutral';
 return <div className="duty-clock" aria-busy={loading||actionLoading}>
  <header className="hr-card-heading duty-clock-heading"><h2><CalendarDays aria-hidden="true"/>My Duty</h2><Button variant="outline" size="icon" className="duty-clock-refresh" aria-label="Refresh attendance status" title="Refresh attendance status" disabled={loading||actionLoading} onClick={onRefresh}><RefreshCw aria-hidden="true" className={loading?'animate-spin':''}/></Button></header>
  <span className="duty-clock-status" data-tone={tone} role="status" aria-label="Attendance status" aria-live="polite" aria-atomic="true"><span aria-hidden="true" className="duty-clock-dot"/>{status}</span>
  {loading?<p role="status" className="hr-muted">Loading attendance status...</p>:<>
   {schedule&&<div className="duty-clock-schedule"><p className="duty-clock-shift">{dutyTime(schedule.startsAt,zone)} – {dutyTime(schedule.endsAt,zone)}</p><p className="duty-clock-dates">{dutyDate(schedule.startsAt,zone)}{overnight&&<> – {dutyDate(schedule.endsAt,zone)} <span>(next day)</span></>}</p><p className="duty-clock-zone">{zone}</p></div>}
   {scheduleResource?.loading&&!schedule&&<p role="status" className="hr-muted">Loading assigned schedule...</p>}
   {scheduleResource?.error&&<div role="alert" className="duty-clock-warning"><p>Assigned schedule unavailable: {scheduleResource.error.message}</p><Button variant="outline" size="sm" onClick={scheduleResource.retry}>Retry my duty</Button></div>}
   {!error&&data&&<><dl className="duty-clock-times"><div><dt>Clock in</dt><dd>{record?.clockInAt?attendanceInstant(record.clockInAt,record.scheduleTimeZone||zone):'—'}</dd></div><div><dt>Clock out</dt><dd>{record?.clockOutAt?attendanceInstant(record.clockOutAt,record.scheduleTimeZone||zone):'—'}</dd></div></dl>
   {showRestriction&&<p className="duty-clock-warning">{explanation}</p>}
   {nextDuty&&<p className="duty-clock-warning">{nextDuty}</p>}
   {record?.isMissingCheckout&&<p role="status" className="duty-clock-warning">Missing checkout requires review. Use the permitted Clock Out action or request a correction in Attendance.</p>}
   {record?.isAfterScheduleEnd&&<p className="duty-clock-warning">Checkout after scheduled end requires review.</p>}
   {record?.approvedAdjustment&&<p className="duty-clock-warning">Approved correction exists. Original recorded times are preserved; see Attendance for review details.</p>}
   </>}
  </>}
  {notice&&<span role="status" className="sr-only">{notice}</span>}
  {error&&<p role="alert" className="duty-clock-error">Attendance status/action unavailable: {error}</p>}
  {pending&&<p role="status" className="duty-clock-warning">Awaiting confirmation for Clock {pending.kind==='in'?'In':'Out'}. Request: {pending.requestId}. Refresh Status checks history without another punch.</p>}
  <div className="duty-clock-actions">{data?.canClockOut?<Button className="duty-clock-action duty-clock-out" onClick={onClockOut} disabled={blocked}><LogOut aria-hidden="true"/>{actionLoading?'Processing…':'Clock Out'}</Button>:data?.canClockIn?<Button className="duty-clock-action" onClick={onClockIn} disabled={blocked}><LogIn aria-hidden="true"/>{actionLoading?'Processing…':'Clock In'}</Button>:null}<Link to="/attendance">View attendance</Link></div>
 </div>;
}

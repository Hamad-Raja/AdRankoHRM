import {Link} from 'react-router';
import {LogIn,LogOut,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {dutyPresentation,attendanceInstant,dutyTime,nextDay} from '@/lib/attendance-clock-presentation';
export default function AttendanceClockCompact({data,loading,actionLoading,error,notice,pending,scheduleResource,onRefresh,onClockIn,onClockOut}){
 const {schedule,actual,explanation,record,scheduleLabel}=dutyPresentation(data,scheduleResource?.data),blocked=loading||actionLoading||!!pending||!!error;
 return <div className="hr-clock">
  <div className="hr-clock-toolbar"><span className="hr-muted">Your attendance</span><Button variant="outline" size="sm" aria-label="Refresh attendance status" disabled={loading||actionLoading} onClick={onRefresh}><RefreshCw aria-hidden="true" className={loading?'animate-spin':''}/>Refresh Status</Button></div>
  {loading?<p role="status" className="hr-muted">Loading attendance status...</p>:<>
   {schedule&&<div className="hr-clock-schedule"><span className="hr-duty-badge">{scheduleLabel}</span><p className="hr-duty-time">{dutyTime(schedule.startsAt,schedule.timeZone)} - {dutyTime(schedule.endsAt,schedule.timeZone)}</p><p className="hr-muted">{schedule.timeZone}{nextDay(schedule)?' - Next day':''}</p><p className="hr-duty-date">Duty start: {schedule.date}</p></div>}
   {scheduleResource?.loading&&!schedule&&<p role="status" className="hr-muted">Loading assigned schedule...</p>}
   {scheduleResource?.error&&<div role="alert"><p>Assigned schedule unavailable: {scheduleResource.error.message}</p><Button variant="outline" size="sm" onClick={scheduleResource.retry}>Retry my duty</Button></div>}
   {!error&&data&&<><p className="hr-clock-status" aria-label="Attendance status">{actual}</p>{explanation&&<p className="hr-muted">{explanation}</p>}
   {scheduleResource?.data?.state==='PENDING_ACTIVATION'&&data.state==='SETUP_REQUIRED'&&<p className="hr-muted">Saved draft pending activation.</p>}
   {scheduleResource?.data?.state==='SCHEDULED_ACTIVATION'&&data.state==='SETUP_REQUIRED'&&<p className="hr-muted">Approved activation is scheduled for a future duty start.</p>}
   {record&&<dl className="hr-clock-times"><div><dt>Recorded Clock In</dt><dd>{attendanceInstant(record.clockInAt,record.scheduleTimeZone)}</dd></div><div><dt>Recorded Clock Out</dt><dd>{attendanceInstant(record.clockOutAt,record.scheduleTimeZone)}</dd></div>{record.workedMinutes!=null&&<div><dt>Raw elapsed (not payable)</dt><dd>{record.workedMinutes} minutes</dd></div>}</dl>}
   {record?.isMissingCheckout&&<p role="status" className="hr-muted">Missing checkout requires review. Use the permitted Clock Out action or request a correction in Attendance.</p>}
   {record?.isAfterScheduleEnd&&<p className="hr-muted">Checkout after scheduled end requires review.</p>}
   {record?.approvedAdjustment&&<p className="hr-muted">Approved correction exists. Original recorded times are preserved; see Attendance for review details.</p>}
   </>}
  </>}
  {notice&&<p role="status" className="hr-clock-notice">{notice}</p>}
  {error&&<p role="alert" className="hr-clock-error">Attendance status/action unavailable: {error}</p>}
  {pending&&<p role="status" className="hr-muted">Awaiting confirmation for Clock {pending.kind==='in'?'In':'Out'}. Request: {pending.requestId}. Refresh Status checks history without another punch.</p>}
  <div className="hr-clock-actions">{data?.canClockOut?<Button variant="destructive" onClick={onClockOut} disabled={blocked}><LogOut aria-hidden="true"/>{actionLoading?'Processing...':'Clock Out'}</Button>:data?.canClockIn?<Button onClick={onClockIn} disabled={blocked}><LogIn aria-hidden="true"/>{actionLoading?'Processing...':'Clock In'}</Button>:null}<Link to="/attendance">Open attendance</Link></div>
 </div>;
}

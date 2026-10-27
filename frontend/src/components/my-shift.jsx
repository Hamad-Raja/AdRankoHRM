import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/employees/management-widgets';
import { getMyShift } from '@/services/attendance-settings.service';
import { useAuth } from '@/context/auth-context';
const labels = { SCHEDULED_ACTIVATION:'Activation approved — future duty start pending', PENDING_ACTIVATION:'Pending activation — no approved effective date is operational yet', SETUP_REQUIRED:'Setup required', PROFILE_LINK_REQUIRED:'Employee profile link required', SCHEDULED:'Scheduled', WEEKLY_OFF:'Weekly off', HOLIDAY:'Approved holiday', NOT_ELIGIBLE:'No eligible employment', LEGACY_ASSIGNMENT_REVIEW:'Individual assignment needs review' };
export default function MyShift() {
  const { refreshSession } = useAuth();
  const [data,setData] = useState(null), [error,setError] = useState(''), [revision,setRevision] = useState(0);
  useEffect(() => { const c = new AbortController(); getMyShift({signal:c.signal}).then(value => {setData(value);setError('');}).catch(e => {if (!c.signal.aborted) { setError(e.message); if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession(); }}); return () => c.abort(); }, [revision, refreshSession]);
  return <Panel title="My Shift"><p className="text-lg font-semibold">7 PM → 5 AM next day</p>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Loading your schedule…</p>}
    {data && <><p role="status">{labels[data.state] || 'Setup required'}</p>
      {data.asOf && <p className="text-xs text-muted-foreground">Schedule checked at {data.asOf}. Refresh to update.</p>}
      {data.draftPreview && <div className="space-y-1 rounded-lg border border-dashed p-3 text-sm"><p className="font-medium">Inactive draft preview — not an active schedule</p><p>{data.draftPreview.timeZone} · Working days (ISO): {data.draftPreview.workDays.join(', ')} · {data.draftPreview.graceMinutes}-minute grace</p><p>Break tracking and automatic deduction disabled. Activation requires an approved effective date.</p></div>}
      {data.state === 'PROFILE_LINK_REQUIRED' ? <p>Contact Admin/HR to link your employee profile. Login accounts are never linked automatically.</p> : <>
      <p>Schedule date (start-date anchor): {data.applicable?.scheduleDate || 'Not available until policy is confirmed'}</p><p>Timezone: {data.applicable?.timeZone || 'Unconfirmed'}</p>
      <p>ISO working days (Monday 1 through Sunday 7): {data.applicable?.workDays?.join(', ') || 'Unconfirmed'}</p>
      {data.applicable?.breakTrackingEnabled === false && <p>Break tracking disabled. Automatic break deduction disabled. The scheduled span is 10 hours; worked/payable time is not calculated here.</p>}
      {data.missing?.length > 0 && <p>Confirmation required: {data.missing.join(', ')}</p>}
      <p>Current overnight duty: {data.current ? `${data.current.scheduleDate}, ${data.current.startTime} → ${data.current.endTime} next day (${data.current.timeZone})` : 'No confirmed ongoing scheduled duty'}</p>
      <p>Next scheduled duty: {data.next ? `${data.next.scheduleDate}, 19:00 → 05:00 next day (${data.next.timeZone})` : 'No confirmed next duty found within the next 366 days'}</p>
      </>}
    </>}
    <p className="text-sm text-muted-foreground">Schedules describe planned duty only. Overnight duty belongs to the date it starts; this does not record attendance.</p><Button variant="outline" onClick={()=>setRevision(v=>v+1)}>Refresh my shift</Button>
  </Panel>;
}

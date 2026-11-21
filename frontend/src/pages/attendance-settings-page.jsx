import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Clock3, Coffee, History, Hourglass, Info, Plus, RotateCw, Settings2, Umbrella } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ActionForm, Field, Panel } from '@/components/employees/management-widgets';
import { EmploymentSelect } from '@/components/employees/employment-dialog';
import { PayrollField } from '@/components/payroll/payroll-fields';
import { calendarDate, dateTime } from '@/components/payroll/payroll-format';
import * as api from '@/services/attendance-settings.service';
import { useAuth } from '@/context/auth-context';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const tableHead = 'border-b border-border/80 bg-muted text-sm font-semibold text-muted-foreground';
const cell = 'px-4 py-3 text-left align-top';
const recorded = value => value ?? 'Not recorded';
const date = value => value ? calendarDate(value) : 'Not approved';
function time(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(`2000-01-01T${value}:00Z`));
}
function Title({ icon: Icon, children }) {
  return <span className="flex items-center gap-3"><Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />{children}</span>;
}
function Status({ children, active = false }) {
  return <Badge variant="outline" className={active ? 'border-primary/25 bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>{children}</Badge>;
}
function Detail({ label, children }) {
  return <div className="min-w-0 space-y-1"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words text-sm font-semibold text-foreground">{children}</dd></div>;
}
function Policy({ policy }) {
  if (!policy) return <p className="text-sm text-muted-foreground">No configuration saved.</p>;
  return <dl className="grid gap-4 text-sm sm:grid-cols-2">
    <Detail label="Office timezone">{recorded(policy.timeZone)}</Detail>
    <Detail label="Working duty starts">{policy.workDays?.map(d => days[d - 1]).join(', ') || 'Not recorded'}</Detail>
    <Detail label="Weekly offs (shift-start dates)">{policy.workDays ? days.filter((_, i) => !policy.workDays.includes(i + 1)).join(', ') || 'None' : 'Not recorded'}</Detail>
    <Detail label="Late grace">{policy.graceMinutes == null ? 'Not recorded' : `${policy.graceMinutes} minutes`}</Detail>
    <Detail label="Break tracking">{policy.breakTrackingEnabled === false ? 'Disabled' : 'Legacy configuration; read-only'}</Detail>
    <Detail label="Automatic break deduction">{policy.automaticBreakDeduction === false ? 'Disabled' : 'Legacy configuration; read-only'}</Detail>
  </dl>;
}
function Weekdays({ workDays, editable = false }) {
  return <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7">{days.map((day, i) => {
    const selected = workDays?.includes(i + 1) || false;
    const style = `flex min-h-16 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-sm font-medium ${editable ? 'has-checked:border-primary/30 has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring' : selected ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'}`;
    return editable ? <label key={day} className={`${style} cursor-pointer`}><input className="size-4 accent-primary" name="workDays" type="checkbox" value={i + 1} defaultChecked={selected} aria-label={day} /><span aria-hidden="true">{day.slice(0, 3)}</span></label> : <div key={day} className={style}><span className="sr-only">{`${day}: ${selected ? 'working duty start' : workDays ? 'weekly off' : 'not configured'}`}</span><Check aria-hidden="true" className={`size-4 ${selected ? '' : 'invisible'}`} /><span aria-hidden="true">{day.slice(0, 3)}</span></div>;
  })}</div>;
}
function HolidaySelection({ events }) {
  const [value, setValue] = useState('');
  return <PayrollField label="Approved announcement to cancel"><EmploymentSelect className="!h-9" name="eventId" required value={value} placeholder="Select approved announcement" options={events.map(e => [e.id, date(e.holidayDate)])} onChange={e => setValue(e.target.value)} /></PayrollField>;
}
export default function AttendanceSettingsPage() {
  const { refreshSession } = useAuth();
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const draftEditor = useRef(null), holidayEditor = useRef(null);
  const refresh = () => { setLoading(true); setRevision(v => v + 1); };
  useEffect(() => {
    const c = new AbortController();
    api.getAttendanceSettings({ signal: c.signal }).then(value => {
      if (!c.signal.aborted) { setData(value); setError(''); }
    }).catch(e => {
      if (!c.signal.aborted) { setError(e.message); if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession(); }
    }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [revision, refreshSession]);
  const draft = data?.draft, latest = data?.versions.at(-1), active = data?.activeVersion, policy = active?.policy;
  const draftPolicy = draft?.policy || data?.confirmedPolicy;
  const duty = active || data?.duty;
  const hours = duty ? `${time(duty.startTime)} - ${time(duty.endTime)}${duty.endsNextDay ? ' next day' : ''}` : 'Not recorded';
  const latestEvents = [], seen = new Set();
  for (const event of data?.holidayEvents || []) if (!seen.has(event.holidayDate)) { seen.add(event.holidayDate); latestEvents.push(event); }
  const holidays = latestEvents.filter(e => e.action === 'ANNOUNCE'), cancellable = latestEvents.filter(e => e.canCancel);
  const openDraft = () => { draftEditor.current.open = true; draftEditor.current.scrollIntoView({ block: 'start', behavior: 'smooth' }); draftEditor.current.querySelector('summary')?.focus({ preventScroll: true }); };
  const manageHolidays = () => { holidayEditor.current.scrollIntoView({ block: 'start', behavior: 'smooth' }); holidayEditor.current.focus({ preventScroll: true }); };
  const policyRows = [...(draft && !draft.activation ? [{ ...draft, isDraft: true }] : []), ...[...(data?.versions || [])].reverse()];
  return <section className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Attendance Settings</h1><p className="mt-2 text-sm text-muted-foreground">Configure attendance policy, working duty starts and company holidays.</p></div>
      <Button variant="outline" disabled={loading} onClick={refresh}><RotateCw aria-hidden="true" />Reload settings</Button>
    </header>
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading settings...</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}{data && ' Last loaded settings are shown. Reload before another change.'}</p>}
    {data && <fieldset aria-label="Attendance policy configuration" disabled={loading || !!error} className="min-w-0 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        [Clock3, 'Office Hours', hours],
        [CalendarDays, 'Working Days', policy?.workDays ? `${policy.workDays.map(d => days[d - 1].slice(0, 3)).join(', ')} (${policy.workDays.length} days)` : 'No active policy'],
        [Hourglass, 'Grace Time', policy?.graceMinutes == null ? 'Not configured' : `${policy.graceMinutes} minutes`],
        [Coffee, 'Break Policy', !policy ? 'No active policy' : policy.breakTrackingEnabled === false && policy.automaticBreakDeduction === false ? 'Tracking / deduction disabled' : 'Legacy configuration; read-only'],
      ].map(([Icon, label, value]) => <div key={label} className="flex min-w-0 items-start gap-4 rounded-xl border border-border bg-card p-5"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Icon aria-hidden="true" className="size-5" /></span><div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p></div></div>)}</div>
      {!active && <p role="status" className="text-sm text-muted-foreground">Inactive - no approved effective date has started. Common duty timings are shown; draft values are not operational.</p>}
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7"><Panel title={<Title icon={Settings2}>Attendance Policy</Title>}>
          <div className="flex flex-wrap items-center gap-2"><Status active={!!active}>{active ? 'Active approved policy' : 'No active policy'}</Status><span className="text-sm text-muted-foreground">Effective from: {date(active?.effectiveFrom)}{active && ` at ${time(active.startTime)}`}</span></div>
          <Policy policy={policy} />
          <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"><Detail label="Office duty timings">{hours}</Detail><Detail label="Timing controls">Fixed common duty; read-only</Detail></dl>
          <div className="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-semibold">Policy note</p><p className="mt-1 text-muted-foreground">Duties, weekly offs and holidays use the shift-start date.{duty?.endsNextDay && ' An evening duty can continue into a weekly-off morning.'} The scheduled span is not actual worked or payable time. This page does not record breaks or calculate deductions.</p></div></div>
          <div className="space-y-3 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Latest saved draft</h3><Status>{data.draftStatus.replaceAll('_', ' ')}</Status></div>{draft ? <><p className="text-sm">Revision {draft.revision}{draft.activation ? ` - activation approved for ${date(draft.activation.effectiveFrom)} at ${time(data.duty.startTime)} (${draft.policy.timeZone})` : ' - inactive until an activation date is approved'}</p><details className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">View saved draft configuration</summary><div className="mt-4 space-y-4"><Policy policy={draft.policy} /><p className="break-words">{draft.reason}</p><p className="break-all text-xs text-muted-foreground">Saved by (account ID): {draft.actorUserId}<br />Saved at (Asia/Karachi): {dateTime(draft.createdAt, { numericDate: true })}</p></div></details></> : <p className="text-sm text-muted-foreground">No draft saved. Suggested settings are available in the revision editor and are not an active policy.</p>}<Button variant="outline" onClick={openDraft}><Plus aria-hidden="true" />Create new revision</Button></div>
          <p className="text-xs text-muted-foreground">Server snapshot (Asia/Karachi): {dateTime(data.asOf, { numericDate: true })}. Reload to update operational status.</p>
        </Panel></div>
        <div className="min-w-0 space-y-5 lg:col-span-5">
          <Panel title={<Title icon={CalendarDays}>Working Schedule</Title>}><p className="text-sm text-muted-foreground">Active policy duty starts. Change working days through an inactive revision.</p><Weekdays workDays={policy?.workDays} /><p className="text-sm"><span className="text-muted-foreground">Weekly offs: </span>{policy?.workDays ? days.filter((_, i) => !policy.workDays.includes(i + 1)).join(', ') || 'None' : 'Not configured'}</p></Panel>
          <Panel title={<Title icon={Umbrella}>Holiday Policy</Title>}><p className="text-sm text-muted-foreground">{policy?.holidayPolicy === 'COMPANY_ANNOUNCED' ? 'Company-announced dates only.' : policy ? `Preserved policy: ${policy.holidayPolicy || 'Not recorded'}` : 'No active holiday policy.'}</p><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium">Company holidays <Status>{holidays.length} recorded</Status></p><Button variant="outline" onClick={manageHolidays}>Manage Holidays</Button></div>{holidays.length ? <ul className="flex max-h-40 flex-wrap gap-2 overflow-y-auto text-sm">{holidays.map(e => <li key={e.id} className="rounded-lg border border-border bg-background px-3 py-2">{date(e.holidayDate)}</li>)}</ul> : <p className="text-sm text-muted-foreground">No company closures have been recorded.</p>}<p className="text-xs text-muted-foreground">Only recorded approvals override duty starts. No assumed national or religious closures.</p></Panel>
        </div>
      </div>
      {data.legacyAssignmentCount > 0 && <p role="alert" className="rounded-xl border border-border bg-card p-4 text-sm">{data.legacyAssignmentCount} individual assignment records are preserved. Affected dates need an explicit policy decision.</p>}
      <details ref={draftEditor} className="scroll-mt-36 rounded-xl focus-within:outline-ring"><summary className="cursor-pointer rounded-xl border border-border bg-card p-4 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-ring">Create inactive draft revision</summary><div className="mt-4"><ActionForm key={`draft-${draft?.id || 'new'}`} title="Save an inactive draft revision" submit="Save inactive draft" reset={false} onSaved={refresh} action={(form, options) => api.saveScheduleDraft({ expectedPreviousId: draft?.id || null, reason: form.get('reason'), policy: { timeZone: form.get('timeZone').trim(), workDays: form.getAll('workDays').map(Number), graceMinutes: Number(form.get('graceMinutes')), breakTrackingEnabled: false, automaticBreakDeduction: false, holidayPolicy: 'COMPANY_ANNOUNCED' } }, options)}>
        <div className="space-y-4"><Field label="Office timezone" name="timeZone" required defaultValue={draftPolicy?.timeZone || ''} /><Field label="Late grace minutes" name="graceMinutes" type="number" required min={0} max={599} defaultValue={draftPolicy?.graceMinutes ?? ''} /><Field label="Draft change reason" name="reason" maxLength={1000} required /></div>
        <div className="min-w-0 space-y-4"><fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium">Working days for this draft (shift-start dates)</legend><Weekdays workDays={draftPolicy?.workDays} editable /></fieldset><div className="space-y-2 rounded-lg border border-border bg-background p-3 text-sm"><p>Break tracking: <Status>Disabled</Status></p><p>Automatic break deduction: <Status>Disabled</Status></p><p className="text-muted-foreground">No break duration, paid/unpaid allowance or late deduction is configured here. Holiday policy: company-announced dates only.</p></div></div>
        <p className="text-sm text-muted-foreground sm:col-span-2">No effective date is required for a draft. Saving creates a new audited revision and leaves active policies unchanged.</p>
      </ActionForm></div></details>
      {draft && !draft.activation && <ActionForm key={`activate-${draft.id}-${latest?.id || 'none'}`} title="Approve effective date and activate" submit="Approve activation date" onSaved={refresh} action={(form, options) => api.activateSchedule({ draftId: draft.id, expectedPreviousId: latest?.id || null, effectiveFrom: form.get('effectiveFrom'), reason: form.get('reason') }, options)}><Field label="Approved effective shift-start date" name="effectiveFrom" type="date" required /><Field label="Activation approval reason" name="reason" required maxLength={1000} /><p className="text-sm text-muted-foreground sm:col-span-2">Choose a business-approved future working-day duty start at {time(data.duty.startTime)} in the draft timezone. Earlier or ongoing duties cannot be rewritten. Leaving this blank keeps the draft inactive.</p></ActionForm>}
      <Panel title={<Title icon={History}>Recent Policy Revisions</Title>}>
        {!policyRows.length ? <p className="text-sm text-muted-foreground">No saved draft or approved policy history.</p> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[48rem] text-sm"><thead className={tableHead}><tr>{['Revision / policy', 'Effective date', 'Office timezone', 'Status', 'Recorded by', 'Details'].map(label => <th scope="col" key={label} className={cell}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{policyRows.map(row => <tr key={row.id} className="hover:bg-muted/30"><td className={cell}>{row.isDraft ? `Draft revision ${row.revision}` : draft && row.draftId === draft.id ? `Revision ${draft.revision}` : <span title={row.id}>Policy {row.id.slice(0, 8)}</span>}</td><td className={cell}>{row.isDraft ? 'Not approved' : <>{date(row.effectiveFrom)}<p className="text-xs text-muted-foreground">{time(row.startTime)}</p></>}</td><td className={`${cell} break-words`}>{recorded(row.policy.timeZone)}</td><td className={cell}><Status active={!row.isDraft && row.id === active?.id}>{row.isDraft ? 'Inactive draft' : row.id === active?.id ? 'Active' : !active || row.effectiveFrom > active.effectiveFrom ? 'Scheduled' : 'Previous'}</Status></td><td className={`${cell} max-w-48 break-all`}><p className="text-xs text-muted-foreground">{row.isDraft ? 'Saved by (account ID)' : row.draftId ? 'Activation approved by (account ID)' : 'Recorded by (account ID)'}</p>{row.actorUserId}</td><td className={cell}><details><summary className="cursor-pointer font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">View details</summary><div className="mt-3 min-w-56 space-y-3"><p className="break-words">{row.reason}</p><p className="text-xs text-muted-foreground">Recorded (Asia/Karachi): {dateTime(row.createdAt, { numericDate: true })}</p><Policy policy={row.policy} /></div></details></td></tr>)}</tbody></table></div>}
      </Panel>
      <section ref={holidayEditor} tabIndex={-1} className="min-w-0 scroll-mt-36 space-y-5 outline-none focus-visible:outline-2 focus-visible:outline-ring" aria-label="Manage company holidays">
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2"><ActionForm key={`holiday-${revision}`} title="Approve a company holiday announcement" submit="Approve holiday announcement" onSaved={refresh} action={(form, options) => { const holidayDate = form.get('holidayDate'), previous = latestEvents.find(e => e.holidayDate === holidayDate); return api.announceHoliday({ holidayDate, expectedPreviousId: previous?.id || null, reason: form.get('reason') }, options); }}><Field label="Company holiday shift-start date" name="holidayDate" type="date" required /><Field label="Holiday announcement approval reason" name="reason" required maxLength={1000} /><p className="text-sm text-muted-foreground sm:col-span-2">Only recorded approvals override the weekly schedule. An empty list means no closures recorded. No artificial coverage period is used.</p></ActionForm>
        <fieldset disabled={!cancellable.length} className="min-w-0"><ActionForm key={`cancel-${revision}`} title="Cancel an upcoming announcement" submit="Cancel holiday announcement" onSaved={refresh} action={(form, options) => api.cancelHoliday(form.get('eventId'), { expectedPreviousId: form.get('eventId'), reason: form.get('reason') }, options)}><HolidaySelection events={cancellable} /><Field label="Cancellation reason" name="reason" required maxLength={1000} /><p className="text-sm text-muted-foreground sm:col-span-2">Cancellation adds history; it never deletes an approval. Already-started duties cannot be changed.{!cancellable.length && ' No upcoming announcements are eligible for cancellation.'}</p></ActionForm></fieldset></div>
        <Panel title="Company holiday announcements">{!latestEvents.length ? <p className="text-sm text-muted-foreground">No company closures have been recorded.</p> : <ul className="divide-y divide-border">{latestEvents.map(e => <li key={e.id} className="space-y-1 py-3 text-sm"><div className="flex flex-wrap items-center gap-3"><span className="font-medium">{date(e.holidayDate)}</span><Status active={e.action === 'ANNOUNCE'}>{e.action === 'ANNOUNCE' ? 'Approved announcement' : 'Cancelled'}</Status></div><p className="break-words">{e.reason}</p><p className="break-all text-xs text-muted-foreground">Revision {e.revision} - Account ID: {e.actorUserId} - {dateTime(e.createdAt, { numericDate: true })} (Asia/Karachi)</p></li>)}</ul>}</Panel>
        <Panel title="Holiday change history">{!data.holidayEvents.length ? <p className="text-sm text-muted-foreground">No announcement history.</p> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[44rem] text-sm"><thead className={tableHead}><tr>{['Holiday date', 'Action / revision', 'Reason', 'Recorded by / at'].map(label => <th scope="col" key={label} className={cell}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{data.holidayEvents.map(e => <tr key={e.id}><td className={cell}>{date(e.holidayDate)}</td><td className={cell}>{e.action} - {e.revision}</td><td className={`${cell} max-w-sm break-words`}>{e.reason}</td><td className={`${cell} break-all`}>{e.actorUserId}<p className="text-xs text-muted-foreground">{dateTime(e.createdAt, { numericDate: true })} (Asia/Karachi)</p></td></tr>)}</tbody></table></div>}</Panel>
      </section>
    </fieldset>}
  </section>;
}

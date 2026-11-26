import {ThemedSelect} from '@/components/ui/themed-select';
import {Badge} from '@/components/ui/badge';
import {employeeDate} from './employee-options';
import {dateTime} from '@/components/payroll/payroll-format';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';
import { dateOnly } from './management-utils';

export function Panel({ title, actions, children }) {
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">{actions?<header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{actions}</header>:<h2 className="text-lg font-semibold">{title}</h2>}{children}</section>;
}
export function Field({ label, options, ...props }) {
  const id = useId();
  return <div className="min-w-0 space-y-1 text-sm"><label htmlFor={id} className="block font-medium">{label}</label>{options ? <ThemedSelect id={id} className="h-9 w-full rounded-lg border border-input bg-background/80 px-3 py-1.5 text-sm shadow-2xs focus-visible:outline-2 focus-visible:outline-ring" {...props}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</ThemedSelect> : <Input id={id} {...props} />}</div>;
}
// Never retry writes. An uncertain response locks this mounted form until an explicit read/reload.
export function ActionForm({ title, children, action, onSaved, submit = 'Save', reset = true, onBusyChange }) {
  const { getCsrfToken, refreshSession } = useAuth();
  const [state, setState] = useState({ busy: false, error: '', saved: false, uncertain: false });
  const lock = useRef(false);
  async function send(event) {
    event.preventDefault();
    if (lock.current || state.uncertain) return;
    lock.current = true; onBusyChange?.(true);
    const form = event.currentTarget;
    setState({ busy: true, error: '', saved: false, uncertain: false });
    let started = false;
    try {
      const csrfToken = getCsrfToken();
      started = true;
      await action(new FormData(form), { csrfToken });
      setState({ busy: false, error: '', saved: true, uncertain: false });
      if (reset) form.reset();
      onSaved?.();
    } catch (error) {
      const uncertain = started && (error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE');
      const details = Array.isArray(error.details) ? error.details.map(d => `${d.field}: ${d.message}`).join(' ') : '';
      setState({ busy: false, saved: false, uncertain, error: `${error.message} ${details}` });
      if (error.status === 401 || error.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
    } finally { lock.current = false; onBusyChange?.(false); }
  }
  return <Panel title={title}><form onSubmit={send} className="space-y-4" aria-busy={state.busy}>
    {state.error && <p role="alert" tabIndex={-1} className="break-words text-sm text-destructive">{state.error}</p>}
    {state.uncertain && <p role="alert">The save result is unconfirmed. Read the current records or reload before another submission.</p>}
    {state.saved && <p role="status">Saved successfully.</p>}
    <fieldset disabled={state.busy || state.uncertain} className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</fieldset>
    <Button disabled={state.busy || state.uncertain} type="submit">{state.busy ? 'Saving…' : submit}</Button>
  </form></Panel>;
}
export function History({ data, detailed=false }) {
  if(detailed)return <DetailedHistory data={data}/>;
  return <Panel title="Employment and assignment history">
    {!data.episodes.length && <p>No employment episodes recorded.</p>}
    {data.episodes.map(e => <article key={e.id} className="space-y-2 border-b pb-3"><h3 className="font-medium">{dateOnly(e.startDate)} — {dateOnly(e.endDate)} · {e.status}</h3>
      <ul className="space-y-2 text-sm">{e.statusEvents.map(s => <li key={s.id}>{dateOnly(s.effectiveDate)}: {s.fromStatus || 'Initial'} → {s.toStatus}{s.reason && <p className="break-words text-muted-foreground">{s.reason}</p>}</li>)}</ul></article>)}
    <h3 className="font-medium">Organization assignments</h3>
    {!data.assignments.length && <p>No assignments recorded.</p>}
    {data.assignments.map(a => <article key={a.id} className="break-words border-b pb-2 text-sm">{dateOnly(a.effectiveFrom)} — {dateOnly(a.effectiveTo)} · {a.team?.name||'No team'} · {a.designation?.name}<p>{a.department?.name||a.team?.department?.name} / {a.campaign?.name||a.team?.campaign?.name||'No campaign'}</p>{a.reportingManager&&<p>Reporting Manager: {a.reportingManager.displayName}</p>}{a.reason && <p className="text-muted-foreground">{a.reason}</p>}</article>)}
  </Panel>;
}

const historyLabel=value=>value?value.toLowerCase().split('_').map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' '):'Not recorded';
const historyDate=value=>value?employeeDate(value.slice(0,10)):'Not recorded';
function HistoryFields({values}){return <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">{values.map(([label,value])=><div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value||'Not recorded'}</dd></div>)}</dl>;}
function DetailedHistory({data}){return <div className="space-y-5"><Panel title="Employment events">{!data.episodes.length&&<p className="text-sm text-muted-foreground">No employment episodes recorded.</p>}{data.episodes.map(e=><article key={e.id} className="min-w-0 space-y-4 border-b pb-4 last:border-0"><header className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{historyDate(e.startDate)} &ndash; {e.endDate?historyDate(e.endDate):'Present'}</h3><Badge variant="outline">{historyLabel(e.status)}</Badge></header><HistoryFields values={ [['Joining date',historyDate(e.startDate)],['Employment end',e.endDate?historyDate(e.endDate):'Present'],['Status effective',historyDate(e.statusEffectiveDate)],...(e.probationEndDate?[['Probation end',historyDate(e.probationEndDate)]]:[]),...(e.confirmedOn?[['Confirmed on',historyDate(e.confirmedOn)]]:[])] }/>{e.statusEvents?.length?<ol className="space-y-3 border-l border-border pl-4">{e.statusEvents.map(event=><li key={event.id} className="space-y-1 text-sm [overflow-wrap:anywhere]"><p className="font-medium">{historyDate(event.effectiveDate)} &middot; {event.fromStatus?historyLabel(event.fromStatus):'Initial'} &rarr; {historyLabel(event.toStatus)}</p>{event.reason&&<p className="whitespace-pre-wrap text-muted-foreground">{event.reason}</p>}{event.actorUserId&&<p className="text-xs text-muted-foreground">Actor: {event.actorName||event.actorUserId}</p>}{event.createdAt&&<p className="text-xs text-muted-foreground">Recorded: {dateTime(event.createdAt)} (Asia/Karachi)</p>}{event.approvedByUserId&&<p className="text-xs text-muted-foreground">Approved by: {event.approvedByName||event.approvedByUserId}{event.approvedAt&&<> &middot; {dateTime(event.approvedAt)} (Asia/Karachi)</>}</p>}</li>)}</ol>:<p className="text-sm text-muted-foreground">No status events recorded.</p>}</article>)}</Panel><Panel title="Organization assignments">{!data.assignments.length&&<p className="text-sm text-muted-foreground">No assignments recorded.</p>}{data.assignments.map(a=><article key={a.id} className="space-y-3 border-b pb-4 last:border-0"><h3 className="text-sm font-semibold">{historyDate(a.effectiveFrom)} &ndash; {a.effectiveTo?historyDate(a.effectiveTo):'Present'}</h3><HistoryFields values={ [['Designation',a.designation?.name],['Department',a.department?.name||a.team?.department?.name],['Campaign',a.campaign?.name||a.team?.campaign?.name],['Team',a.team?.name],['Reporting manager',a.reportingManager?.displayName],...(a.actorUserId?[['Actor',a.actorName||a.actorUserId]]:[]),...(a.createdAt?[['Recorded',dateTime(a.createdAt)+' (Asia/Karachi)']]:[])] }/>{a.reason&&<div className="text-sm"><p className="text-muted-foreground">Change reason</p><p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{a.reason}</p></div>}</article>)}</Panel></div>;}

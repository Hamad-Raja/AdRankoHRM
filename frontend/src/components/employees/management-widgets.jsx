import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';
import { dateOnly } from './management-utils';

export function Panel({ title, children }) {
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>;
}
export function Field({ label, options, ...props }) {
  const id = useId();
  return <div className="min-w-0 space-y-1 text-sm"><label htmlFor={id} className="block">{label}</label>{options ? <select id={id} className="min-h-10 w-full rounded-lg border bg-background p-2" {...props}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select> : <Input id={id} {...props} />}</div>;
}
// Never retry writes. An uncertain response locks this mounted form until an explicit read/reload.
export function ActionForm({ title, children, action, onSaved, submit = 'Save', reset = true }) {
  const { getCsrfToken, refreshSession } = useAuth();
  const [state, setState] = useState({ busy: false, error: '', saved: false, uncertain: false });
  const lock = useRef(false);
  async function send(event) {
    event.preventDefault();
    if (lock.current || state.uncertain) return;
    lock.current = true;
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
    } finally { lock.current = false; }
  }
  return <Panel title={title}><form onSubmit={send} className="space-y-4" aria-busy={state.busy}>
    {state.error && <p role="alert" tabIndex={-1} className="break-words text-sm text-destructive">{state.error}</p>}
    {state.uncertain && <p role="alert">The save result is unconfirmed. Read the current records or reload before another submission.</p>}
    {state.saved && <p role="status">Saved successfully.</p>}
    <fieldset disabled={state.busy || state.uncertain} className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</fieldset>
    <Button disabled={state.busy || state.uncertain} type="submit">{state.busy ? 'Saving…' : submit}</Button>
  </form></Panel>;
}
export function History({ data }) {
  return <Panel title="Employment and assignment history">
    {!data.episodes.length && <p>No employment episodes recorded.</p>}
    {data.episodes.map(e => <article key={e.id} className="space-y-2 border-b pb-3"><h3 className="font-medium">{dateOnly(e.startDate)} — {dateOnly(e.endDate)} · {e.status}</h3>
      <ul className="space-y-2 text-sm">{e.statusEvents.map(s => <li key={s.id}>{dateOnly(s.effectiveDate)}: {s.fromStatus || 'Initial'} → {s.toStatus}{s.reason && <p className="break-words text-muted-foreground">{s.reason} · Actor {s.actorUserId}</p>}</li>)}</ul></article>)}
    <h3 className="font-medium">Organization assignments</h3>
    {!data.assignments.length && <p>No assignments recorded.</p>}
    {data.assignments.map(a => <article key={a.id} className="break-words border-b pb-2 text-sm">{dateOnly(a.effectiveFrom)} — {dateOnly(a.effectiveTo)} · {a.team.name} · {a.designation.name}<p>{a.team.department.name} / {a.team.campaign.name}</p>{a.reason && <p className="text-muted-foreground">{a.reason} · Actor {a.actorUserId}</p>}</article>)}
  </Panel>;
}

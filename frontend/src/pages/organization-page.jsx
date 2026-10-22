import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ActionForm, Field, Panel } from '@/components/employees/management-widgets';
import { dateOnly, formObject } from '@/components/employees/management-utils';
import * as org from '@/services/organization.service';
export default function OrganizationPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [kind, setKind] = useState('DEPARTMENT');
  const refresh = () => setRevision(v => v + 1);
  useEffect(() => { const c = new AbortController(); org.organization({ signal: c.signal }).then(result => { setData(result); setError(''); }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [revision]);
  const choices = type => [[ '', `Select ${type.toLowerCase()}` ], ...(data?.units || []).filter(u => u.kind === type && !u.archivedAt).map(u => [u.id, u.name])];
  return <section className="mx-auto max-w-4xl space-y-6"><h1 className="text-2xl font-semibold">Organization management</h1>
    {error && <p role="alert">{error}</p>}<Button variant="outline" onClick={refresh}>Refresh organization</Button>
    {!data && !error && <p role="status">Loading organization…</p>}
    <ActionForm title="Create organization record" onSaved={refresh} action={(form, options) => org.createUnit(formObject(form), options)}>
      <Field label="Record kind" name="kind" value={kind} onChange={e => setKind(e.target.value)} options={['DEPARTMENT', 'CAMPAIGN', 'TEAM', 'DESIGNATION'].map(k => [k, k])} />
      <Field label="Name" name="name" required maxLength={120} />{kind === 'TEAM' && <><Field label="Department" name="departmentId" required options={choices('DEPARTMENT')} /><Field label="Campaign" name="campaignId" required options={choices('CAMPAIGN')} /></>}
      <Field label="Creation reason" name="reason" required maxLength={1000} />
    </ActionForm>
    <Panel title="Organization records">{data?.units.length === 0 && <p>No organization records yet.</p>}{data?.units.map(u => <article key={u.id} className="break-words border-b py-3"><h3 className="font-medium">{u.name} · {u.kind} {u.archivedAt ? '(Archived)' : ''}</h3>{u.kind === 'TEAM' && <p className="text-sm">{data.units.find(v => v.id === u.departmentId)?.name} / {data.units.find(v => v.id === u.campaignId)?.name}</p>}<p className="text-xs text-muted-foreground">Created {u.createdAt} · Actor {u.actorUserId} · {u.reason}</p></article>)}</Panel>
    <ActionForm title="Archive organization record" onSaved={refresh} action={(form, options) => org.archiveUnit(form.get('id'), { reason: form.get('reason') }, options)}><Field label="Record to archive" name="id" required options={[[ '', 'Select record' ], ...(data?.units || []).filter(u => !u.archivedAt).map(u => [u.id, `${u.kind}: ${u.name}`])]} /><Field label="Archive reason" name="reason" required maxLength={1000} /><p className="text-sm text-muted-foreground">Archiving preserves history and existing assignments. New assignments cannot use archived records or teams with archived parents.</p></ActionForm>
    <ActionForm title="Assign team manager" onSaved={refresh} action={(form, options) => { const values = formObject(form); const id = values.teamId; delete values.teamId; return org.assignManager(id, values, options); }}>
      <Field label="Team" name="teamId" required options={choices('TEAM')} /><Field label="Manager account UUID" name="managerUserId" required />
      <Field label="Manager effective from" name="effectiveFrom" type="date" required /><Field label="Manager effective to (optional)" name="effectiveTo" type="date" /><Field label="Manager change reason" name="reason" required maxLength={1000} />
      <p className="text-sm text-muted-foreground">Use the linked Manager account ID from its employee profile. A later assignment closes the preceding open interval.</p>
    </ActionForm>
    <Panel title="Manager assignment history">{data?.managers.length === 0 && <p>No managers assigned.</p>}{data?.managers.map(a => <article key={a.id} className="break-words border-b py-3 text-sm">{data.units.find(u => u.id === a.teamId)?.name} · {a.manager.displayName}<p>{dateOnly(a.effectiveFrom)} — {dateOnly(a.effectiveTo)} · {a.reason}</p><p className="text-xs text-muted-foreground">Actor {a.actorUserId}</p></article>)}</Panel>
  </section>;
}


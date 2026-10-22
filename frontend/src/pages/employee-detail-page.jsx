import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import EmployeeForm from '@/components/employees/employee-form';
import { ActionForm, Field, History, Panel } from '@/components/employees/management-widgets';
import { formObject } from '@/components/employees/management-utils';
import { useAuth } from '@/context/auth-context';
import { getEmployeeById, updateEmployee } from '@/services/employee.service';
import * as org from '@/services/organization.service';

export function Documents({ employeeId, management, refreshKey = 0 }) {
  const [docs, setDocs] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => { const c = new AbortController(); org.listDocuments(employeeId, { signal: c.signal }).then(result => { setDocs(result); setError(''); }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [employeeId, revision, refreshKey]);
  return <div className="space-y-4"><Panel title="Private documents">
    {error && <p role="alert">{error}</p>}{!docs && !error && <p role="status">Loading documents…</p>}
    <Button variant="outline" onClick={() => setRevision(v => v + 1)}>Refresh documents</Button>
    {docs?.length === 0 && <p>No visible documents.</p>}
    {docs?.map(d => <article key={d.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b py-3"><div className="min-w-0 break-words"><p className="font-medium">{d.title}</p><p className="text-xs text-muted-foreground">{d.createdAt} · {d.byteLength} bytes · {d.ownerVisible ? 'Visible to employee' : 'Admin/HR only'}</p>{d.replacesId && <p className="break-all text-xs">Replaces {d.replacesId}</p>}</div><Button variant="outline" onClick={() => org.downloadDocument(employeeId, d).catch(e => setError(e.message))}>Download {d.title}</Button></article>)}
  </Panel>{management && <ActionForm title="Upload document or replacement" submit="Upload document" onSaved={() => setRevision(v => v + 1)} action={(form, options) => {
    const file = form.get('file'); const metadata = { title: form.get('title'), ownerVisible: form.get('ownerVisible') };
    if (form.get('replacesId')) metadata.replacesId = form.get('replacesId');
    return org.uploadDocument(employeeId, metadata, file, options);
  }}><Field label="Document title" name="title" required maxLength={120} /><Field label="File (UTF-8 text or plain RGB/RGBA PNG, maximum 5 MiB)" name="file" type="file" accept="text/plain,image/png" required />
    <Field label="Visibility" name="ownerVisible" options={[[ 'false', 'Admin/HR only' ], ['true', 'Also visible to owning employee']]} />
    <Field label="Replace existing document (history retained)" name="replacesId" options={[[ '', 'New document' ], ...(docs || []).filter(d => !docs.some(other => other.replacesId === d.id)).map(d => [d.id, d.title])]} />
  </ActionForm>}</div>;
}

function EmployeeDetail({ employeeId }) {
  const { getCsrfToken, refreshSession, user } = useAuth();
  const [employee, setEmployee] = useState(null), [history, setHistory] = useState(null), [units, setUnits] = useState([]);
  const [loadError, setLoadError] = useState(''), [revision, setRevision] = useState(0), [editing, setEditing] = useState(false);
  const [write, setWrite] = useState({ busy: false, error: '', uncertain: false, conflict: false, success: '' });
  const [formKey, setFormKey] = useState(0), lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([getEmployeeById(employeeId, { signal: c.signal }), org.history(employeeId, { signal: c.signal }), org.organization({ signal: c.signal })]).then(([e, h, o]) => { setEmployee(e); setHistory(h); setUnits(o.units); setLoadError(''); }).catch(e => {
      if (!c.signal.aborted) { setLoadError(`${e.status === 404 ? 'Employee not found. ' : e.status === 403 ? 'Access forbidden. ' : ''}${e.message}`); if (e.status === 401) void refreshSession(); }
    }); return () => c.abort();
  }, [employeeId, revision, refreshSession]);
  async function save(data) {
    if (lock.current || write.uncertain || write.conflict) return;
    lock.current = true; setWrite({ busy: true, error: '', uncertain: false, conflict: false, success: '' });
    let started = false;
    try {
      const csrfToken = getCsrfToken(); started = true;
      const saved = await updateEmployee(employeeId, data, { csrfToken }); setEmployee(saved); setEditing(false);
      setWrite({ busy: false, error: '', uncertain: false, conflict: false, success: 'Profile changes saved.' });
    } catch (e) {
      setWrite({ busy: false, success: '', conflict: e.status === 409, uncertain: started && (e.status === 0 || e.status >= 500 || e.code === 'INVALID_RESPONSE'), error: [e.message, ...(e.details || []).map(d => `${d.field}: ${d.message}`)].join(' ') });
      if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();
    } finally { lock.current = false; }
  }
  async function loadCurrent() {
    // Explicit user action discards the draft; a failed reload leaves it intact.
    try { const latest = await getEmployeeById(employeeId); setEmployee(latest); setFormKey(v => v + 1); setWrite({ busy: false, error: '', conflict: false, uncertain: false, success: 'Current profile loaded. Review before saving.' }); } catch (e) { setWrite(w => ({ ...w, error: e.message })); }
  }
  const active = kind => units.filter(u => u.kind === kind && !u.archivedAt).map(u => [u.id, u.name]);
  return <section className="mx-auto max-w-4xl space-y-6"><Link className="text-primary underline" to="/employees">Employee directory</Link>
    {loadError ? <Panel title="Unable to load employee"><p role="alert">{loadError}</p><Button onClick={() => setRevision(v => v + 1)}>Retry employee</Button></Panel> : !employee ? <p role="status">Loading employee…</p> : <>
    <h1 className="break-words text-2xl font-semibold">{employee.fullName}</h1><p>{employee.employeeCode} · {employee.employment?.status || 'No employment'} · Profile version {employee.version}</p>
    {write.error && <p role="alert" className="break-words text-destructive">{write.error}</p>}{write.success && <p role="status">{write.success}</p>}
    {write.conflict && <p role="alert">Someone changed this profile. Your draft is preserved. Saving is blocked until you explicitly load the current profile.</p>}
    {write.uncertain && <p role="alert">The save result is unconfirmed. Your draft is preserved. Load the current profile to check the result before any new write.</p>}
    {(write.conflict || write.uncertain) && <Button onClick={loadCurrent}>Discard draft and load current profile</Button>}
    {editing ? <EmployeeForm key={formKey} employee={employee} onSubmit={save} busy={write.busy} blocked={write.uncertain || write.conflict} /> : <Panel title="Employee profile"><dl className="grid gap-4 sm:grid-cols-2">{['fullName', 'personalEmail', 'phone', 'address', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship'].map(key => <div key={key} className="min-w-0"><dt className="text-sm text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="break-words">{employee[key] || 'Not recorded'}</dd></div>)}</dl><Button onClick={() => { setEditing(true); setFormKey(v => v + 1); }}>Edit profile</Button></Panel>}
    {editing && !write.busy && <Button variant="outline" onClick={() => setEditing(false)}>Cancel editing</Button>}
    {history && <History data={history} />}
    <ActionForm key={`assignment-${revision}`} title="Change organization assignment" onSaved={() => setRevision(v => v + 1)} action={(form, options) => org.assignEmployee(employeeId, formObject(form), options)}>
      <Field label="Team" name="teamId" required options={[[ '', 'Select team' ], ...active('TEAM')]} /><Field label="Designation / job title" name="designationId" required options={[[ '', 'Select designation' ], ...active('DESIGNATION')]} />
      <Field label="Effective from" name="effectiveFrom" type="date" required /><Field label="Effective to (optional)" name="effectiveTo" type="date" /><Field label="Assignment change reason" name="reason" required maxLength={1000} />
      <p className="text-sm text-muted-foreground">A later assignment ends the previous open assignment on the preceding day. Closed history is preserved.</p>
    </ActionForm>
    {employee.userId ? <Panel title="Login account"><p className="break-all">Linked account: {employee.userId}</p><p>Profile email and login email remain separate. Account linkage cannot be changed here.</p></Panel> : <ActionForm title="Provision or link login account" submit="Save account linkage" onSaved={() => setRevision(v => v + 1)} action={(form, options) => {
      const data = formObject(form); if (data.mode === 'link') { delete data.password; delete data.role; }
      return org.linkAccount(employeeId, data, options);
    }}><Field label="Account operation" name="mode" options={[[ 'provision', 'Create new account (forced password change)' ], ['link', 'Link existing account']]} /><Field label="Login email" name="email" type="email" required maxLength={254} />
      <Field label="Initial password (new account only, 8 characters minimum, 72 UTF-8 bytes maximum)" name="password" type="password" autoComplete="new-password" />
      <Field label="New account role" name="role" options={user.role === 'ADMIN' ? [['EMPLOYEE', 'Employee'], ['MANAGER', 'Manager']] : [['EMPLOYEE', 'Employee']]} />
      <p className="text-sm text-muted-foreground">No email is sent. Existing Admin/HR accounts cannot be linked. HR may only create/link ordinary Employee accounts.</p>
    </ActionForm>}
    <Documents employeeId={employeeId} management />
    </>}
  </section>;
}

export default function EmployeeDetailPage() { const { employeeId } = useParams(); return <EmployeeDetail key={employeeId} employeeId={employeeId} />; }


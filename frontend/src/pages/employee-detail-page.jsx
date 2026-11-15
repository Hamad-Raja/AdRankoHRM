import { useEffect, useRef, useState } from 'react';

import { Link, useLocation, useParams } from 'react-router';

import { Button } from '@/components/ui/button';

import Dialog from '@/components/payroll/payroll-dialog';

import ManagedPasswordDialog from '@/components/employees/managed-password-dialog';

import EmployeeForm from '@/components/employees/employee-form';

import OrganizationAssignmentEditor from '@/components/employees/organization-assignment-editor';

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

    <Field label="Visibility" name="ownerVisible" options={[['false', 'Admin/HR only'], ['true', 'Also visible to owning employee']]} />

    <Field label="Replace existing document (history retained)" name="replacesId" options={[['', 'New document'], ...(docs || []).filter(d => !docs.some(other => other.replacesId === d.id)).map(d => [d.id, d.title])]} />

  </ActionForm>}</div>;

}



function EmployeeDetail({ employeeId }) {

  const location=useLocation();

  const [tab,setTab]=useState('Personal Information'),[editDirty,setEditDirty]=useState(false),[resetting,setResetting]=useState(false);

  const { getCsrfToken, refreshSession, user } = useAuth();

  const [employee, setEmployee] = useState(null), [history, setHistory] = useState(null), [organization, setOrganization] = useState(null);

  const [loadError, setLoadError] = useState(''), [revision, setRevision] = useState(0), [editing, setEditing] = useState(()=>location.state?.editProfile===true);

  const [write, setWrite] = useState({ busy: false, error: '', uncertain: false, conflict: false, success: '' });

  const [formKey, setFormKey] = useState(0), lock = useRef(false);

  useEffect(() => {

    const c = new AbortController();

    Promise.all([getEmployeeById(employeeId, { signal: c.signal }), org.history(employeeId, { signal: c.signal }), org.organization({ signal: c.signal })]).then(([e, h, o]) => {if(c.signal.aborted)return; setEmployee(e); setHistory(h); setOrganization(o); setLoadError(''); }).catch(e => {

      if (!c.signal.aborted) { setLoadError(`${e.status === 404 ? 'Employee not found. ' : e.status === 403 ? 'Access forbidden. ' : ''}${e.message}`); if (e.status === 401) void refreshSession(); }

    }); return () => c.abort();

  }, [employeeId, revision, refreshSession]);

  async function save(data) {

    if (lock.current || write.uncertain || write.conflict) return;

    lock.current = true; setWrite({ busy: true, error: '', uncertain: false, conflict: false, success: '' });

    let started = false;

    try {

      const csrfToken = getCsrfToken(); started = true;

      const saved = await updateEmployee(employeeId, data, { csrfToken }); setEmployee(saved); setEditing(false);setEditDirty(false);setRevision(v=>v+1);

      setWrite({ busy: false, error: '', uncertain: false, conflict: false, success: 'Profile changes saved.' });

    } catch (e) {

      setWrite({ busy: false, success: '', conflict: e.status === 409, uncertain: started && (e.status === 0 || e.status >= 500 || e.code === 'INVALID_RESPONSE'), error: [e.message, ...(e.details || []).map(d => `${d.field}: ${d.message}`)].join(' ') });

      if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') void refreshSession();

    } finally { lock.current = false; }

  }

  async function loadCurrent() {

    // Explicit user action discards the draft; a failed reload leaves it intact.

    try { const latest = await getEmployeeById(employeeId); setEmployee(latest); setFormKey(v => v + 1); setEditDirty(false); setWrite({ busy: false, error: '', conflict: false, uncertain: false, success: 'Current profile loaded. Review before saving.' }); } catch (e) { setWrite(w => ({ ...w, error: e.message })); }

  }

  return <section className="min-w-0 space-y-6">

    <Link to="/employees" className="text-sm text-primary underline">Employee directory</Link>

    {loadError?<Panel title="Unable to load employee"><p role="alert">{loadError}</p><Button onClick={()=>setRevision(v=>v+1)}>Retry employee</Button></Panel>:!employee?<p role="status">Loading employee...</p>:<>

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5"><div><h1 className="text-2xl font-semibold">{employee.fullName}</h1><p className="mt-2 text-sm text-muted-foreground">{employee.employeeCode} · {employee.employment?.status||'No employment'} · <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{employee.salaryConfigured?'Salary configured':'Salary not configured'}</span></p></div><Link to={'/employment?employeeId='+employeeId} className="rounded-lg border border-border px-4 py-2 text-sm text-primary">Employment workflows</Link></header>

      {location.state?.created&&<p role="status" className="text-sm text-primary">Employee created successfully. Profile, account, organization and optional salary were saved together.</p>}

      <nav aria-label="Employee profile sections" className="flex flex-wrap gap-2">{['Personal Information','Employment & Organization','Login Access','Documents','History'].map(label=><Button key={label} variant={tab===label?'default':'outline'} aria-pressed={tab===label} onClick={()=>setTab(label)}>{label}</Button>)}</nav>

      {!editing&&write.error&&<p role="alert" className="text-sm text-destructive">{write.error}</p>}{write.success&&<p role="status" className="text-sm text-primary">{write.success}</p>}

      {tab==='Personal Information'&&<Panel title="Employee profile"><dl className="grid gap-4 sm:grid-cols-2">{['fullName','personalEmail','phone','address','cnic','location','emergencyContactName','emergencyContactPhone','emergencyContactRelationship'].map(key=><div key={key} className="min-w-0"><dt className="text-sm capitalize text-muted-foreground">{key.replace(/([A-Z])/g,' $1')}</dt><dd className="mt-1 break-words">{employee[key]||'Not recorded'}</dd></div>)}</dl><Button onClick={()=>{setEditDirty(false);setEditing(true);setFormKey(v=>v+1);}}>Edit profile</Button></Panel>}

      {tab==='Employment & Organization'&&<>

        <Panel title="Employment details"><p>Joined {employee.employment?.startDate||'Not recorded'} · {employee.employment?.employmentType||'Type not recorded'}</p><p className="text-sm text-muted-foreground">Lifecycle, salary and organization changes use their dated workflows.</p></Panel>

        {employee.organization&&<Panel title="Current organization"><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Department',employee.organization.department?.name],['Campaign',employee.organization.campaign?.name],['Team',employee.organization.team?.name],['Job Title',employee.organization.designation?.name],['Reporting Manager',employee.organization.reportingManager?.displayName]].map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1">{value||'Not assigned'}</dd></div>)}</dl></Panel>}

        {employee.plannedOrganization&&<Panel title="Planned organization"><p>Effective {employee.plannedOrganization.effectiveFrom.slice(0,10)} · {employee.plannedOrganization.department?.name} · {employee.plannedOrganization.designation?.name}</p></Panel>}

        <OrganizationAssignmentEditor key={`assignment-${revision}-${employee.organization?.id||'none'}`} employeeId={employeeId} current={employee.organization} data={organization} onSaved={()=>setRevision(v=>v+1)}/>

      </>}

      {tab==='Login Access'&&<>

        {employee.userId?<Panel title="Login account"><p>Login email: {employee.user?.email||'Linked account'}</p><p className="mt-1 text-sm text-muted-foreground">Login and personal emails are separate. Password reset never reactivates access.</p>{(['EMPLOYEE','MANAGER'].includes(employee.user?.role)||(user.role==='ADMIN'&&employee.user?.role==='HR'&&employee.userId!==user.id))&&<Button onClick={()=>setResetting(true)}>Reset account password</Button>}</Panel>:<ActionForm title="Provision or link login account" submit="Save account linkage" onSaved={()=>setRevision(v=>v+1)} action={(form,options)=>{const data=formObject(form);if(data.mode==='link'){delete data.password;delete data.role;}return org.linkAccount(employeeId,data,options);}}><Field label="Account operation" name="mode" options={[["provision","Create new account"],["link","Link existing account"]]}/><Field label="Login email" name="email" type="email" required maxLength={254}/><Field label="Initial password" name="password" type="password" autoComplete="new-password"/><Field label="New account role" name="role" options={user.role==='ADMIN'?[['EMPLOYEE','Employee'],['MANAGER','Manager']]:[['EMPLOYEE','Employee'],['MANAGER','Manager']]}/><p className="text-sm text-muted-foreground">HR provisions Employee and Manager accounts only. Existing HR/Admin accounts cannot be linked here.</p></ActionForm>}

      </>}

      {tab==='Documents'&&<Documents employeeId={employeeId} management/>}

      {tab==='History'&&history&&<History data={history}/>}

      {editing&&<Dialog title="Edit Employee Profile" description="Maintain personal information and the displayed employment episode. Dated assignments and salary use separate workflows." wide confirmDiscard busy={write.busy} dirty={editDirty} uncertain={write.uncertain||write.conflict} error={write.error||undefined} onReload={loadCurrent} recoveryLabel="Discard draft and load current profile" onClose={()=>{setEditing(false);setEditDirty(false);}}>{close=><EmployeeForm key={formKey} employee={employee} onSubmit={save} busy={write.busy} blocked={write.uncertain||write.conflict} onCancel={close} onDirtyChange={setEditDirty}/>}</Dialog>}

      {resetting&&<ManagedPasswordDialog employee={employee} onClose={()=>setResetting(false)} onSaved={()=>{setRevision(v=>v+1);setWrite(w=>({...w,success:'Account password reset; existing sessions revoked.'}));}}/>}

    </>}

  </section>;

}



export default function EmployeeDetailPage() { const { employeeId } = useParams(); return <EmployeeDetail key={employeeId} employeeId={employeeId} />; }

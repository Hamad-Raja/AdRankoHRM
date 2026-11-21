import {employeeCreationRoles} from './employee-account-rules';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Eye, EyeOff, LoaderCircle, UserRound, Hash, Phone, Mail, MapPin, Building2, Megaphone, UsersRound, BriefcaseBusiness, CalendarDays, LockKeyhole, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import * as org from '@/services/organization.service';

const control = 'h-11 w-full min-w-0 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';
const profileFields = ['fullName', 'phone', 'personalEmail', 'address', 'cnic', 'location', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship'];
function Section({ number, title, description, children }) {
  return <section className="min-w-0 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5"><div className="mb-4 flex items-center gap-3 border-b border-border pb-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">{number}</span><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-0.5 text-sm text-muted-foreground">{description}</p></div></div>{children}</section>;
}
function FormField({ label, icon: Icon, error, options, children, ...props }) {
  const id = useId();
  const [validationMessage, setValidationMessage] = useState('');
  const message = error || validationMessage;
  const attributes = {
    ...props, id, 'aria-label': label, 'aria-invalid': Boolean(message),
    'aria-describedby': message ? id + '-error' : undefined,
    onInvalid: event => setValidationMessage(event.target.validationMessage),
    onChange: event => { setValidationMessage(''); props.onChange?.(event); },
    className: `${control} ${Icon ? 'pl-10' : ''}`,
  };
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="block text-sm font-medium">{label}{props.required && <span aria-hidden="true" className="ml-1 text-destructive">*</span>}</label>
    <div className="relative">
      {Icon && <Icon aria-hidden="true" className="pointer-events-none absolute top-3 left-3 size-5 text-muted-foreground" />}
      {options ? <select {...attributes}>{options.map(([value,text]) => <option key={value} value={value}>{text}</option>)}</select> : <input {...attributes} />}
      {children}
    </div>
    {message && <p id={id+'-error'} className="text-sm text-destructive">{message}</p>}
  </div>;
}
export default function EmployeeForm({ employee = null, onSubmit, busy = false, blocked = false, issues = [], onCancel, onDirtyChange }) {
  const { user } = useAuth(), editing = Boolean(employee), formRef = useRef(null), locked = useRef(false);
  const [values,setValues] = useState(()=>({ ...Object.fromEntries(profileFields.map(key=>[key,employee?.[key] || ''])), employeeCode:employee?.employeeCode || '', autoCode:!employee,
    employmentType:employee?.employment?.employmentType||'',startDate:employee?.employment?.startDate || '', status:employee?.employment?.status || 'ACTIVE', probationEndDate:employee?.employment?.probationEndDate || '', confirmedOn:employee?.employment?.confirmedOn || '',
    departmentId:'',campaignId:'',teamId:'',designationId:'',reportingManagerId:'',loginEmail:'',loginRole:'EMPLOYEE',password:'',confirmPassword:'' }));
  const [metadata,setMetadata] = useState(null), [loadError,setLoadError] = useState(''), [revision,setRevision] = useState(0), [errors,setErrors] = useState({}), [showPassword,setShowPassword] = useState(false);
  useEffect(()=>{ if(editing)return;const controller=new AbortController();org.organization({signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setMetadata(data);setLoadError('');}}).catch(error=>{if(!controller.signal.aborted)setLoadError(error.message);});return()=>controller.abort(); },[editing,revision]);
  const disabled=busy||blocked;
  const units=metadata?.units || [];
  const active=unit=>!unit.archivedAt && (!unit.departmentId||!units.find(parent=>parent.id===unit.departmentId)?.archivedAt) && (!unit.campaignId||!units.find(parent=>parent.id===unit.campaignId)?.archivedAt);
  const choices=(kind,predicate=()=>true)=>[['',`Select ${kind==='DESIGNATION'?'job title':kind.toLowerCase()}`],...units.filter(unit=>unit.kind===kind&&active(unit)&&predicate(unit)).map(unit=>[unit.id,unit.name])];
  const managerOptions=[['','No reporting manager'],...(metadata?.eligibleManagers||[]).map(manager=>[manager.id,[manager.employee?.fullName||manager.displayName,manager.employee?.employeeCode,manager.employee?.assignments[0]?.designation?.name].filter(Boolean).join(' — ')])];
  function suggestedManager(teamId,date){return (metadata?.managers||[]).find(item=>item.teamId===teamId&&item.effectiveFrom.slice(0,10)<=date&&(!item.effectiveTo||item.effectiveTo.slice(0,10)>=date))?.managerUserId || '';}
  function change(event){const {name,value,type,checked}=event.target;onDirtyChange?.(true);setValues(old=>{
    const next={...old,[name]:type==='checkbox'?checked:value};
    if(name==='departmentId')Object.assign(next,{campaignId:'',teamId:'',reportingManagerId:''});
    if(name==='campaignId')Object.assign(next,{teamId:'',reportingManagerId:''});
    if(name==='teamId'||name==='startDate')next.reportingManagerId=suggestedManager(next.teamId,next.startDate);
    if(name==='status'&&value==='PROBATION')next.confirmedOn='';return next;
  });setErrors(old=>({...old,[name]:''}));}
  const errorFor=name=>errors[name]||issues.find(issue=>issue.field===name||issue.field===({startDate:'employment.startDate',status:'employment.status',loginEmail:'portalLogin.email',password:'portalLogin.password'}[name]||'organization.'+name))?.message;
  const field=(name,label,icon,extra={})=><FormField name={name} label={label} icon={icon} value={values[name]} onChange={change} error={errorFor(name)} {...extra} />;
  async function submit(event){event.preventDefault();if(disabled||locked.current)return;
    const nextErrors={};if(!editing){if(values.password!==values.confirmPassword)nextErrors.confirmPassword='Passwords do not match.';if(Array.from(values.password).length<8||new TextEncoder().encode(values.password).length>72)nextErrors.password='Use at least 8 characters and at most 72 UTF-8 bytes.';}
    setErrors(nextErrors);if(Object.keys(nextErrors).length){queueMicrotask(()=>formRef.current?.querySelector('[aria-invalid="true"]')?.focus());return;}
    const profile=Object.fromEntries(profileFields.map(key=>[key,values[key].trim()||null]));
    locked.current=true;try{await onSubmit(editing?{version:employee.version,...profile,...(employee.employment?{employmentType:values.employmentType||null,employmentEpisodeId:employee.employment.id,expectedEmploymentVersion:employee.employment.version}:{}),probationEndDate:values.probationEndDate||null,confirmedOn:values.confirmedOn||null}:{...profile,...(!values.autoCode?{employeeCode:values.employeeCode.trim().toUpperCase()}:{}),
      employment:{startDate:values.startDate,status:values.status,probationEndDate:values.probationEndDate||null,confirmedOn:values.status==='PROBATION'?null:values.confirmedOn||null,reason:'Initial employment created through Add Employee.'},
      organization:{departmentId:values.departmentId,campaignId:values.campaignId||null,teamId:values.teamId||null,designationId:values.designationId,reportingManagerId:values.reportingManagerId||null},
      portalLogin:{email:values.loginEmail.trim().toLowerCase(),password:values.password,role:values.loginRole}});
    }finally{locked.current=false;}
  }
  if(editing)return <form ref={formRef} onSubmit={submit} aria-label="Edit employee profile" className="flex min-h-0 flex-col overflow-hidden" aria-busy={busy} autoComplete="off">
    <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-1 pb-5"><fieldset disabled={disabled} className="space-y-5">
      <Section number="1" title="Personal Information" description="Personal details do not change login email, salary or dated assignments."><div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {field('fullName','Full Name',UserRound,{required:true,maxLength:120})}{field('personalEmail','Personal Email',Mail,{type:'email',maxLength:254})}{field('phone','Phone Number (Pakistan +92)',Phone,{type:'tel',maxLength:32})}{field('cnic','CNIC',Hash,{maxLength:15,inputMode:'numeric',pattern:'(?:[0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])'})}{field('location','Location',MapPin,{maxLength:160})}<div className="sm:col-span-2">{field('address','Address',MapPin,{maxLength:1000})}</div>
      </div></Section>
      <Section number="2" title="Emergency Contact" description="Restricted employee contact information."><div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('emergencyContactName','Emergency Contact Name',UserRound,{maxLength:120})}{field('emergencyContactPhone','Emergency Contact Phone',Phone,{type:'tel',maxLength:32})}{field('emergencyContactRelationship','Emergency Contact Relationship',null,{maxLength:60})}</div></Section>
      {employee.employment&&<Section number="3" title="Employment Details" description={'Episode starting '+employee.employment.startDate+'. Lifecycle dates/status use the authorized employment workflow.'}><div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('employmentType','Employment Type',BriefcaseBusiness,{options:[['','Not recorded'],['FULL_TIME','Full-time'],['PART_TIME','Part-time'],['CONTRACT','Contract'],['INTERNSHIP','Internship'],['TEMPORARY','Temporary']]})}{field('probationEndDate','Probation End Date',CalendarDays,{type:'date',min:employee.employment.startDate,max:'9999-12-31'})}{field('confirmedOn','Confirmation Date',CalendarDays,{type:'date',disabled:values.status==='PROBATION',min:employee.employment.startDate,max:'9999-12-31'})}</div></Section>}
    </fieldset></div><footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={disabled}>{busy?'Saving...':'Save profile changes'}</Button></footer>
  </form>;
  function generate(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';const limit=Math.floor(256/alphabet.length)*alphabet.length;let password='';while(password.length<20){for(const byte of crypto.getRandomValues(new Uint8Array(32)))if(byte<limit&&password.length<20)password+=alphabet[byte%alphabet.length];}setValues(old=>({...old,password,confirmPassword:password}));setErrors({});}
  return <form ref={formRef} onSubmit={submit} autoComplete="off" aria-busy={busy} className="space-y-5"><fieldset disabled={disabled} className="min-w-0 space-y-5"><legend className="sr-only">{editing?'Edit employee profile':'Create employee and login'}</legend>
    <Section number="1" title="Personal Information" description="Basic details about the employee."><div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {field('fullName','Full Name',UserRound,{required:true,maxLength:120,placeholder:'Enter full name'})}
      <div className="space-y-2"><FormField label="Employee Code" icon={Hash} name="employeeCode" value={values.autoCode?'Assigned automatically on save':values.employeeCode} onChange={change} readOnly={editing||values.autoCode} required={!values.autoCode} maxLength={30} error={errorFor('employeeCode')} />{!editing&&<label className="flex items-center gap-2 text-sm text-muted-foreground font-medium"><input type="checkbox" name="autoCode" checked={values.autoCode} onChange={change} />Generate a unique code automatically</label>}</div>
      {field('phone','Phone Number',Phone,{type:'tel',maxLength:32,placeholder:'+92 300 1234567'})}
      {field('personalEmail','Personal Email',Mail,{type:'email',maxLength:254,placeholder:'name@example.com'})}{editing&&field('cnic','CNIC',Hash,{maxLength:15,inputMode:'numeric',pattern:'(?:[0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])'})}{editing&&field('location','Location',MapPin,{maxLength:160})}{editing&&field('employmentType','Employment Type',BriefcaseBusiness,{options:[['','Not recorded'],['FULL_TIME','Full-time'],['PART_TIME','Part-time'],['CONTRACT','Contract'],['INTERNSHIP','Internship'],['TEMPORARY','Temporary']]})}
      <div className="md:col-span-1 xl:col-span-2">{field('address','Address',MapPin,{maxLength:1000,placeholder:'Enter complete address'})}</div>
    </div></Section>
    {!editing&&<Section number="2" title="Job & Organization" description="Assign the employee to the company structure.">
      {loadError&&<div role="alert" className="mb-4 text-sm text-destructive">{loadError} <Button type="button" variant="outline" onClick={()=>setRevision(v=>v+1)}>Retry organization options</Button></div>}
      {!metadata&&!loadError&&<p role="status" className="mb-4 text-sm text-muted-foreground">Loading organization options…</p>}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {field('departmentId','Department',Building2,{options:choices('DEPARTMENT'),required:true})}
        {field('campaignId','Campaign',Megaphone,{options:choices('CAMPAIGN',unit=>!unit.departmentId||unit.departmentId===values.departmentId),disabled:!values.departmentId})}
        {field('teamId','Team',UsersRound,{options:choices('TEAM',unit=>unit.departmentId===values.departmentId&&(unit.campaignId||'')===values.campaignId),disabled:!values.departmentId})}
        {field('designationId','Designation (Job Title)',BriefcaseBusiness,{options:choices('DESIGNATION'),required:true})}
      </div><div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {field('reportingManagerId','Reporting Manager',UserRound,{options:managerOptions})}
        {field('startDate','Joining Date',CalendarDays,{type:'date',required:true,min:'0001-01-01',max:'9999-12-31'})}
        {field('status','Employment Status',null,{options:[['ACTIVE','Active'],['PROBATION','Probation']],required:true})}
      </div><p className="mt-3 text-xs text-muted-foreground">Campaign, team and reporting manager are optional. A team's dated manager is suggested for the joining date. Job titles do not grant portal permissions.</p>
    </Section>}
    {!editing&&<Section number="3" title="Portal Login" description="Create login access for the employee."><div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {field('loginEmail','Login Email',Mail,{type:'email',required:true,maxLength:254,placeholder:'Enter login email'})}
      {field('loginRole','Portal Role',UserRound,{options:employeeCreationRoles(user.role)})}
      {field('password','Password',LockKeyhole,{type:showPassword?'text':'password',required:true,autoComplete:'new-password'})}
      {field('confirmPassword','Confirm Password',LockKeyhole,{type:showPassword?'text':'password',required:true,autoComplete:'new-password'})}
    </div><div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={()=>setShowPassword(value=>!value)} aria-pressed={showPassword}>{showPassword?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}{showPassword?'Hide passwords':'Show passwords'}</Button><Button type="button" variant="outline" onClick={generate}>Generate Strong Password</Button>{values.personalEmail&&<Button type="button" variant="outline" onClick={()=>setValues(old=>({...old,loginEmail:old.personalEmail}))}>Use personal email for login</Button>}</div><p className="mt-3 text-xs text-muted-foreground">Use at least 8 characters and at most 72 UTF-8 bytes. No mailbox is created. Admin or HR can reset Employee and Manager passwords.</p></Section>}
    <details className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"><summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">{editing?'2':'4'}</span><div className="flex-1"><h2 className="text-lg font-semibold">Additional Details (Optional)</h2><p className="mt-0.5 text-sm text-muted-foreground">Employment timeline and emergency contact.</p></div><ChevronDown className="size-5" aria-hidden="true" /></summary><div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {field('emergencyContactName','Emergency Contact Name',UserRound,{maxLength:120})}{field('emergencyContactPhone','Emergency Contact Phone',Phone,{type:'tel',maxLength:32})}{field('emergencyContactRelationship','Emergency Contact Relationship',null,{maxLength:60})}
      {field('probationEndDate','Probation End Date',CalendarDays,{type:'date',min:values.startDate||'0001-01-01',max:'9999-12-31'})}{field('confirmedOn','Confirmation Date',CalendarDays,{type:'date',disabled:values.status==='PROBATION',min:values.startDate||'0001-01-01',max:'9999-12-31'})}
    </div></details>
    <div className="flex flex-wrap items-center justify-end gap-3">{!busy&&onCancel&&<Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}{!busy&&!onCancel&&<Link to={editing?`/employees/${employee.id}`:'/employees'} className="inline-flex h-11 items-center rounded-lg border border-input px-6 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Cancel</Link>}<Button type="submit" disabled={disabled||(!editing&&!metadata)} className="min-h-11 px-6">{busy&&<LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>}{busy?'Saving…':editing?'Save profile changes':'Create Employee'}</Button></div>
  </fieldset></form>;
}

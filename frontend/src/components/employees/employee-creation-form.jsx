import {FieldInput} from '@/components/ui/field-input';
import {ThemedSelect} from '@/components/ui/themed-select';
import {teamMatchesCampaign,retainEligibleTeam} from './management-utils';
import {employeeCreationRoles} from './employee-account-rules';
import {useEffect,useRef,useState} from 'react';
import {Eye,EyeOff,ShieldCheck,ChevronRight,ChevronLeft,LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {PayrollField} from '@/components/payroll/payroll-fields';
import {inputClass} from '@/components/payroll/payroll-format';
import {InitialsAvatar} from './directory-parts';
import {employmentTypes} from './employee-options';
import {useAuth} from '@/context/auth-context';
import {organization} from '@/services/organization.service';

const initial={fullName:'',employeeCode:'',autoCode:true,personalEmail:'',phone:'',address:'',cnic:'',location:'',employmentType:'',departmentId:'',campaignId:'',teamId:'',designationId:'',reportingManagerId:'',startDate:'',status:'ACTIVE',loginEmail:'',loginRole:'EMPLOYEE',password:'',confirmPassword:'',emergencyContactName:'',emergencyContactPhone:'',emergencyContactRelationship:'',probationEndDate:'',confirmedOn:'',monthlyBasic:'',salaryMonth:''};
const profileFields=['fullName','personalEmail','phone','address','cnic','location','emergencyContactName','emergencyContactPhone','emergencyContactRelationship'];
const paths={startDate:'employment.startDate',status:'employment.status',employmentType:'employment.employmentType',probationEndDate:'employment.probationEndDate',confirmedOn:'employment.confirmedOn',loginEmail:'portalLogin.email',loginRole:'portalLogin.role',password:'portalLogin.password',monthlyBasic:'startingSalary.monthlyBasic',salaryMonth:'startingSalary.effectiveMonth'};
function validMoney(value){if(!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))return false;const [whole,fraction='']=value.split('.');const minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));return minor>0n&&minor<=99999999999999n;}
function passwordValue(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%',limit=Math.floor(256/alphabet.length)*alphabet.length;let result='';while(result.length<20)for(const byte of crypto.getRandomValues(new Uint8Array(32)))if(byte<limit&&result.length<20)result+=alphabet[byte%alphabet.length];return result;}

export default function EmployeeCreationForm({busy,blocked,onSave,onClose,onDirtyChange}){
  const {user}=useAuth(),form=useRef(null),lock=useRef(false),scrollBody=useRef(null);
  const [values,setValues]=useState(initial),[step,setStep]=useState(1),[salaryMonthEdited,setSalaryMonthEdited]=useState(false),[showPassword,setShowPassword]=useState(false),[errors,setErrors]=useState({});
  const [metadata,setMetadata]=useState(null),[loadError,setLoadError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{const c=new AbortController();organization({signal:c.signal}).then(data=>{if(!c.signal.aborted){setMetadata(data);setLoadError('');}}).catch(error=>{if(!c.signal.aborted)setLoadError(error.message);});return()=>c.abort();},[revision]);
  const disabled=busy||blocked,effectiveMonth=salaryMonthEdited?values.salaryMonth:values.startDate.slice(0,7);
  const units=metadata?.units||[];
  const active=unit=>!unit.archivedAt&&(!unit.departmentId||!units.find(parent=>parent.id===unit.departmentId)?.archivedAt)&&(!unit.campaignId||!units.find(parent=>parent.id===unit.campaignId)?.archivedAt);
  const choices=(kind,predicate=()=>true)=>[['',`Select ${kind==='DESIGNATION'?'designation':kind.toLowerCase()}`],...units.filter(unit=>unit.kind===kind&&active(unit)&&predicate(unit)).map(unit=>[unit.id,unit.name])];
  const managers=[['','No reporting manager'],...(metadata?.eligibleManagers||[]).map(manager=>[manager.id,[manager.employee?.fullName||manager.displayName,manager.employee?.employeeCode,manager.employee?.assignments[0]?.designation?.name].filter(Boolean).join(' — ')])];
  function suggestedManager(teamId,date){return metadata?.managers?.find(item=>item.teamId===teamId&&item.effectiveFrom.slice(0,10)<=date&&(!item.effectiveTo||item.effectiveTo.slice(0,10)>=date))?.managerUserId||'';}
  function update(next){setValues(next);onDirtyChange(JSON.stringify(next)!==JSON.stringify(initial));}
  function change(event){const {name,value,type,checked}=event.target,next={...values,[name]:type==='checkbox'?checked:value};
    if(name==='departmentId'||name==='campaignId')Object.assign(next,retainEligibleTeam(next,units,active));

    if(name==='teamId'||name==='startDate')next.reportingManagerId=suggestedManager(next.teamId,next.startDate);
    if(name==='status'&&value==='PROBATION')next.confirmedOn='';
    if(name==='salaryMonth')setSalaryMonthEdited(true);
    update(next);setErrors(old=>({...old,[name]:''}));
  }
  function go(next){setStep(next);scrollBody.current?.scrollTo({top:0,behavior:'instant'});}
  function next(){if(disabled||!metadata||!form.current.reportValidity())return;const checks={};if(!values.fullName.trim())checks.fullName='Full name is required.';if(!values.autoCode&&!/^[A-Z0-9][A-Z0-9_-]*$/i.test(values.employeeCode.trim()))checks.employeeCode='Use letters, numbers, hyphens or underscores.';for(const name of ['phone','emergencyContactPhone'])if(values[name].trim()&&(!/^\+?[0-9(). -]+$/.test(values[name].trim())||!/[0-9]/.test(values[name])))checks[name]='Enter a valid phone number, for example +92 300 1234567.';if(values.password!==values.confirmPassword)checks.confirmPassword='Passwords do not match.';if(Array.from(values.password).length<8||new TextEncoder().encode(values.password).length>72)checks.password='Use at least 8 characters and at most 72 UTF-8 bytes.';setErrors(checks);if(Object.keys(checks).length){queueMicrotask(()=>form.current?.querySelector('[aria-invalid="true"]')?.focus());return;}go(2);}
  async function save(withSalary){
    if(disabled||lock.current||!metadata)return;
    if(withSalary&&!validMoney(values.monthlyBasic)){setErrors({monthlyBasic:'Enter positive PKR with at most two decimals (maximum 999,999,999,999.99).'});return;}
    const profile=Object.fromEntries(profileFields.map(key=>[key,values[key].trim()||null]));
    const data={...profile,...(!values.autoCode?{employeeCode:values.employeeCode.trim().toUpperCase()}:{}),employment:{startDate:values.startDate,status:values.status,employmentType:values.employmentType||null,probationEndDate:values.probationEndDate||null,confirmedOn:values.status==='PROBATION'?null:values.confirmedOn||null,reason:'Initial employment created through Add Employee.'},organization:{departmentId:values.departmentId,campaignId:values.campaignId||null,teamId:values.teamId||null,designationId:values.designationId,reportingManagerId:values.reportingManagerId||null},portalLogin:{email:values.loginEmail.trim().toLowerCase(),password:values.password,role:values.loginRole},...(withSalary?{startingSalary:{monthlyBasic:values.monthlyBasic,effectiveMonth}}:{})};
    lock.current=true;try{const result=await onSave(data);if(result?.issues){const mapped={};for(const issue of result.issues){const name=Object.keys(paths).find(key=>paths[key]===issue.field)||issue.field.replace(/^organization\./,'');mapped[name]=issue.message;}setErrors(mapped);if(result.issues.some(issue=>!issue.field.startsWith('startingSalary')))go(1);}}finally{lock.current=false;}
  }
  const field=(name,label,extra={})=><PayrollField label={label} error={errors[name]}><FieldInput className={inputClass} name={name} value={name==='salaryMonth'?effectiveMonth:values[name]} onChange={change} {...extra}/></PayrollField>;
  const select=(name,label,options,extra={})=><PayrollField label={label} error={errors[name]}><ThemedSelect className={inputClass} name={name} value={values[name]} onChange={change} {...extra}>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</ThemedSelect></PayrollField>;
  return <form ref={form} onSubmit={event=>{event.preventDefault();if(step===1)next();else void save(true);}} aria-label="Create employee" autoComplete="off" aria-busy={busy} className="flex min-h-0 flex-col overflow-hidden">
    <nav aria-label="Employee creation steps" className="app-tabs mb-4 shrink-0"><button type="button" aria-current={step===1?'step':undefined} disabled={disabled} onClick={()=>go(1)} className={`min-h-11 px-2 py-3 focus-visible:outline-2 focus-visible:outline-ring ${step===1?'bg-primary text-primary-foreground':'bg-background/40 text-muted-foreground'}`}>1. Personal & Employment</button><button type="button" aria-current={step===2?'step':undefined} disabled={disabled||!metadata} onClick={()=>{if(step===1)next();}} className={`min-h-11 px-2 py-3 focus-visible:outline-2 focus-visible:outline-ring ${step===2?'bg-primary text-primary-foreground':'bg-background/40 text-muted-foreground'}`}>2. Starting Salary (Optional)</button></nav>
    <div ref={scrollBody} className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-5">
      <fieldset disabled={disabled} className="min-w-0 space-y-5">
        <div hidden={step!==1} data-step="1" className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-4"><InitialsAvatar name={values.fullName||'New Employee'}/><div className="min-w-0"><p className="break-words font-semibold">{values.fullName||'New Employee'}</p><p className="mt-1 text-xs text-muted-foreground">{values.autoCode?'Employee code assigned on save':values.employeeCode||'Enter an employee code'}</p></div></div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field('fullName','Full Name',{required:true,maxLength:120,placeholder:'Enter full name'})}
            <div className="space-y-2"><PayrollField label="Employee Code" error={errors.employeeCode}><FieldInput className={inputClass} name="employeeCode" readOnly={values.autoCode} required={!values.autoCode} maxLength={30} value={values.autoCode?'Assigned automatically on save':values.employeeCode} onChange={change}/></PayrollField><label className="flex items-center gap-2 text-sm text-muted-foreground font-medium"><input type="checkbox" className="accent-primary" name="autoCode" checked={values.autoCode} onChange={change}/>Generate a unique code automatically</label></div>
            {field('personalEmail','Personal Email',{type:'email',maxLength:254,placeholder:'name@example.com'})}{field('phone','Phone Number (Pakistan +92)',{type:'tel',maxLength:32,placeholder:'+92 300 1234567'})}
            <div className="sm:col-span-2">{field('address','Address',{maxLength:1000,placeholder:'Complete address'})}</div>
            {field('cnic','CNIC (Optional)',{inputMode:'numeric',maxLength:15,pattern:'(?:[0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])',placeholder:'12345-1234567-1'})}{field('location','Location (Optional)',{maxLength:160,placeholder:'Office or city'})}
            {select('departmentId','Department',choices('DEPARTMENT'),{required:true})}{select('designationId','Designation (Job Title)',choices('DESIGNATION'),{required:true})}
            {select('campaignId','Campaign',choices('CAMPAIGN',unit=>!unit.departmentId||unit.departmentId===values.departmentId),{disabled:!values.departmentId})}{select('teamId','Team',choices('TEAM',unit=>teamMatchesCampaign(unit,values.campaignId)),{disabled:!values.departmentId})}
      {values.departmentId&&choices('TEAM',unit=>teamMatchesCampaign(unit,values.campaignId)).length===1&&<p className="text-sm text-muted-foreground">{values.campaignId?'No active teams are available for the selected campaign.':'No active teams are available without a campaign.'}</p>}
            <div className="sm:col-span-2">{select('reportingManagerId','Reporting Manager',managers)}</div>
            {field('startDate','Joining Date',{type:'date',required:true,min:'0001-01-01',max:'9999-12-31'})}{select('employmentType','Employment Type',[['','Not specified'],...employmentTypes])}
            {select('status','Employment Status',[['ACTIVE','Active'],['PROBATION','Probation']],{required:true})}
          </div>
          {loadError?<div role="alert" className="space-y-2 text-sm text-destructive"><p>Organization choices unavailable: {loadError}</p><Button type="button" variant="outline" onClick={()=>setRevision(value=>value+1)}>Retry organization options</Button></div>:!metadata?<p role="status" className="text-sm text-muted-foreground">Loading organization options…</p>:<p className="text-xs text-muted-foreground">Campaign, team and reporting manager are optional. A team's manager is suggested for the joining date.</p>}
          <section aria-label="Portal login" className="space-y-4 border-t border-border pt-4"><h3 className="text-base font-semibold">Portal Login</h3><div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('loginEmail','Login Email',{type:'email',required:true,maxLength:254})}{select('loginRole','Portal Role',employeeCreationRoles(user.role))}{field('password','Password',{required:true,type:showPassword?'text':'password',autoComplete:'new-password'})}{field('confirmPassword','Confirm Password',{required:true,type:showPassword?'text':'password',autoComplete:'new-password'})}</div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}{showPassword?'Hide passwords':'Show passwords'}</Button><Button type="button" variant="outline" onClick={()=>{const password=passwordValue();update({...values,password,confirmPassword:password});setErrors({});}}>Generate Strong Password</Button>{values.personalEmail&&<Button type="button" variant="outline" onClick={()=>update({...values,loginEmail:values.personalEmail})}>Use personal email for login</Button>}</div><p className="text-xs text-muted-foreground">Use at least 8 characters and at most 72 UTF-8 bytes. No email is sent.</p></section>
          <section aria-label="Emergency contact details" className="space-y-4 rounded-xl border border-primary/25 bg-primary/10 p-4"><h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><ShieldCheck aria-hidden="true" className="size-4"/>Emergency Contact Details</h3><div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('emergencyContactName','Emergency Contact Name',{maxLength:120})}{field('emergencyContactPhone','Emergency Contact Phone (Pakistan +92)',{type:'tel',maxLength:32,placeholder:'+92 300 1234567'})}<div className="sm:col-span-2">{field('emergencyContactRelationship','Emergency Contact Relationship',{maxLength:60})}</div></div></section>
          <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Additional Employment Details (Optional)</summary><div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">{field('probationEndDate','Probation End Date',{type:'date',min:values.startDate||'0001-01-01',max:'9999-12-31'})}{field('confirmedOn','Confirmation Date',{type:'date',disabled:values.status==='PROBATION',min:values.startDate||'0001-01-01',max:'9999-12-31'})}</div></details>
        </div>
        <div hidden={step!==2} data-step="2" className="space-y-5">
          <p className="text-sm leading-relaxed text-muted-foreground">Set the employee’s starting monthly basic salary. Bonuses, allowances, and deductions can be entered when preparing monthly payroll.</p>
          <div className="rounded-xl border border-border bg-background/40 p-4 text-sm"><p className="break-words font-semibold">{values.fullName}</p><p className="mt-1 text-muted-foreground">{values.autoCode?'Employee code assigned on save':values.employeeCode}</p></div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('monthlyBasic','Monthly Basic Salary (PKR)',{inputMode:'decimal',required:step===2,maxLength:15,placeholder:'45000.00'})}{field('salaryMonth','Effective From — Month',{type:'month',required:step===2,min:'0001-01',max:'9999-12'})}</div>
        </div>
      </fieldset>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card pt-4">{step===1?<><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={disabled||!metadata}>Next: Starting Salary<ChevronRight aria-hidden="true"/></Button></>:<><Button type="button" variant="outline" disabled={disabled} onClick={()=>go(1)}><ChevronLeft aria-hidden="true"/>Back</Button><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled} onClick={()=>void save(false)}>Skip & Save</Button><Button type="submit" disabled={disabled}>{busy&&<LoaderCircle aria-hidden="true" className="size-4 animate-spin"/>}{busy?'Saving…':'Save Employee'}</Button></div></>}</footer>
  </form>;
}

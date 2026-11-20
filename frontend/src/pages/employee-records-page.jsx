import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import {ArrowLeft,RefreshCw,Search} from 'lucide-react';
import {useAuth} from '@/context/auth-context';
import {useApiResource} from '@/lib/use-api-resource';
import {searchEmployeeRecords,employeeRecordPath} from '@/services/employee-record.service';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {inputClass,readable} from '@/components/payroll/payroll-format';
import {EmploymentBadge,InitialsAvatar} from '@/components/employees/directory-parts';
import {RecordSummary,RecordHistory,RecordFinances,RecordDocuments,RecordPager,RecordResource,RecordValue} from '@/components/employees/employee-record-panels';
const recorded=value=><RecordValue value={value}/>;
const tabs=[['summary','Summary'],['history','Employment History'],['payments','Salary & Payments'],['documents','Documents']];
const statuses=['ACTIVE','PROBATION','NOTICE_PERIOD','SUSPENDED','EXITED','FUTURE_START','NO_EMPLOYMENT','UNKNOWN'];
const validId=value=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value||'');
function RecordBadge({status}){return ['ACTIVE','PROBATION','NOTICE_PERIOD','SUSPENDED','EXITED'].includes(status)?<EmploymentBadge status={status}/>:<Badge variant="outline">{readable(status)}</Badge>;}
export default function EmployeeRecordsPage(){
 const {getCsrfToken}=useAuth(),[params,setParams]=useSearchParams();
 const employeeId=validId(params.get('employeeId'))?params.get('employeeId'):null;
 const tab=tabs.some(([key])=>key===params.get('tab'))?params.get('tab'):'summary';
 const page=Math.min(100000,Math.max(1,Number(params.get('page'))||1));
 const status=statuses.includes(params.get('status'))?params.get('status'):'';
 const [draft,setDraft]=useState(''),[applied,setApplied]=useState(''),[statusDraft,setStatusDraft]=useState({source:status,value:status}),[revision,setRevision]=useState(0),[result,setResult]=useState(null);
 const draftStatus=statusDraft.source===status?statusDraft.value:status;
 const tabList=useRef(null),detailHeading=useRef(null),focusEmployee=useRef(null);
 const key=JSON.stringify([applied,status,page,revision]);
 const summary=useApiResource(employeeId?employeeRecordPath(employeeId):null);
 useEffect(()=>{const controller=new AbortController();Promise.resolve().then(()=>{if(!controller.signal.aborted)return searchEmployeeRecords({query:applied,status,page,pageSize:10},getCsrfToken(),controller.signal);}).then(data=>{if(!controller.signal.aborted)setResult({key,data});}).catch(error=>{if(!controller.signal.aborted)setResult({key,error});});return()=>controller.abort();},[key,applied,status,page,getCsrfToken]);
 useEffect(()=>{if(summary.data?.employee.id===focusEmployee.current){detailHeading.current?.focus();focusEmployee.current=null;}},[summary.data]);
 const current=result?.key===key?result:null,loading=!current;
 function update(changes,replace=false){const next=new URLSearchParams(params);for(const [name,value]of Object.entries(changes))if(value===null||value==='')next.delete(name);else next.set(name,String(value));setParams(next,{replace});}
 function search(event){event.preventDefault();setApplied(draft);setRevision(v=>v+1);update({status:draftStatus,page:null,employeeId:null,periodId:null,historyPage:null,paymentPage:null,salaryPage:null,documentPage:null});}
 function select(id){focusEmployee.current=id;update({employeeId:id,periodId:null,historyPage:null,paymentPage:null,salaryPage:null,documentPage:null});requestAnimationFrame(()=>detailHeading.current?.focus());}
 function switchTab(value){update({tab:value});}
 function tabKeys(event,index){let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();switchTab(tabs[next][0]);tabList.current?.querySelectorAll('[role="tab"]')[next]?.focus();}
 return <section className="min-w-0 space-y-5">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Employee Records</h1><p className="mt-2 text-sm text-muted-foreground">Current and former employees, employment history and recorded payments.</p></div><Button variant="outline" disabled={loading||summary.loading} onClick={()=>{setRevision(v=>v+1);void summary.reload().catch(()=>{});}}><RefreshCw aria-hidden="true"/>Refresh records</Button></header>
  <form onSubmit={search} className="grid min-w-0 items-end gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto]">
   <label className="min-w-0 space-y-1.5 text-sm font-medium">Search<div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"/><input className={inputClass+' pl-10'} autoComplete="off" type="search" maxLength={120} aria-label="Search by name, employee code or CNIC" placeholder="Name, employee code or CNIC" value={draft} onChange={e=>setDraft(e.target.value)}/></div></label>
   <label className="min-w-0 space-y-1.5 text-sm font-medium">Employment status<select aria-label="Employment status filter" className={inputClass} value={draftStatus} onChange={e=>setStatusDraft({source:status,value:e.target.value})}><option value="">All employees</option>{statuses.map(s=><option key={s} value={s}>{readable(s)}</option>)}</select></label><Button type="submit" className="min-h-11">Search</Button>
  </form>
  <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
   <section aria-label="Employee results" className={`${employeeId?'hidden lg:block':''} min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground`}>
    <header className="flex items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">Employees</h2>{current?.data&&<span className="text-sm text-muted-foreground">{current.data.total} records</span>}</header>
    {loading?<p role="status" className="p-5 text-sm text-muted-foreground">Loading employee records...</p>:current.error?<div role="alert" className="space-y-3 p-4 text-sm"><p className="break-words text-destructive">{current.error.message}</p><Button variant="outline" onClick={()=>setRevision(v=>v+1)}>Retry employee search</Button></div>:<><ul className="divide-y divide-border">{current.data.employees.map(person=><li key={person.id}><button type="button" aria-pressed={person.id===employeeId} className={`flex w-full min-w-0 items-center justify-between gap-3 p-4 text-left text-sm hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${person.id===employeeId?'bg-primary/15':''}`} onClick={()=>select(person.id)}><span className="min-w-0 flex-1"><span className="block break-words font-semibold">{person.fullName}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{person.employeeCode}</span>{person.maskedCnic&&<span className="mt-1 block break-words text-xs text-muted-foreground">CNIC: {person.maskedCnic}</span>}</span><RecordBadge status={person.status}/></button></li>)}</ul>{!current.data.employees.length&&<p className="p-6 text-center text-sm text-muted-foreground">No matching employees.</p>}<div className="px-4 pb-4"><RecordPager data={current.data} onPage={page=>update({page})} label="employees"/></div></>}
   </section>
   {employeeId?<section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5">
    <Button variant="outline" size="sm" className="mb-4 lg:hidden" onClick={()=>{update({employeeId:null});requestAnimationFrame(()=>document.querySelector('[aria-label="Employee results"] button')?.focus());}}><ArrowLeft aria-hidden="true"/>Back to results</Button>
    <RecordResource resource={summary}>{data=><>
     <header className="flex min-w-0 flex-wrap items-start gap-4"><InitialsAvatar name={data.employee.fullName}/><div className="min-w-0 flex-1"><h2 ref={detailHeading} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight outline-none">{data.employee.fullName}</h2><div className="mt-2 flex flex-wrap items-center gap-3 text-sm"><span className="break-words font-medium">{data.employee.employeeCode}</span><span className="text-muted-foreground">Employment status:</span><RecordBadge status={data.employee.status}/></div><p className="mt-2 break-words text-sm text-muted-foreground">CNIC: {recorded(data.employee.maskedCnic)}</p><p className="mt-1 break-words text-sm text-muted-foreground">Account status: {data.employee.accountStatus?readable(data.employee.accountStatus):'No linked account'}</p><p className="mt-2 break-words text-sm text-muted-foreground">{[data.placement?.designation,data.placement?.department,data.placement?.team,data.placement?.campaign].filter(Boolean).join(' · ')||'Organization details not recorded'}</p></div></header>
     <div ref={tabList} role="tablist" aria-label="Employee record sections" className="app-tabs my-5 border-b border-border pb-4">{tabs.map(([value,title],index)=><button type="button" key={value} role="tab" id={'record-tab-'+value} aria-controls="record-panel" aria-selected={tab===value} tabIndex={tab===value?0:-1} onKeyDown={e=>tabKeys(e,index)} onClick={()=>switchTab(value)}>{title}</button>)}</div>
     <div role="tabpanel" id="record-panel" aria-labelledby={'record-tab-'+tab} tabIndex={0} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      {tab==='summary'&&<RecordSummary data={data}/>}{tab==='history'&&<RecordHistory key={employeeId+':'+revision} employeeId={employeeId} params={params} update={update}/>}{tab==='payments'&&<RecordFinances key={employeeId+':'+revision} employeeId={employeeId} params={params} update={update}/>}{tab==='documents'&&<RecordDocuments key={employeeId+':'+revision} employeeId={employeeId} params={params} update={update}/>}
     </div>
    </>}</RecordResource>
   </section>:<section className="hidden rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground lg:block">Select an employee to review their records.</section>}
  </div>
 </section>;
}

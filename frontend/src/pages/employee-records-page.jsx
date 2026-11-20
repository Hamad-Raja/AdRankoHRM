import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigationType,useSearchParams} from 'react-router';
import {ArrowLeft,ArrowRight,RefreshCw,Search} from 'lucide-react';
import {useAuth} from '@/context/auth-context';
import {useApiResource} from '@/lib/use-api-resource';
import {searchEmployeeRecords,employeeRecordPath,rememberRecordSearch,recallRecordSearch} from '@/services/employee-record.service';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {inputClass,readable} from '@/components/payroll/payroll-format';
import {EmploymentBadge,InitialsAvatar} from '@/components/employees/directory-parts';
import {EmploymentSelect} from '@/components/employees/employment-dialog';
import {RecordSummary,RecordHistory,RecordFinances,RecordDocuments,RecordResource,RecordValue} from '@/components/employees/employee-record-panels';
const recorded=value=><RecordValue value={value}/>;
const tabs=[['summary','Summary'],['history','Employment History'],['payments','Salary & Payments'],['documents','Documents']];
const statuses=['ACTIVE','PROBATION','NOTICE_PERIOD','SUSPENDED','EXITED','FUTURE_START','NO_EMPLOYMENT','UNKNOWN'];
const validId=value=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value||'');
function RecordBadge({status}){return ['ACTIVE','PROBATION','NOTICE_PERIOD','SUSPENDED','EXITED'].includes(status)?<EmploymentBadge status={status}/>:<Badge variant="outline">{readable(status)}</Badge>;}
export default function EmployeeRecordsPage(){
 const {user,getCsrfToken}=useAuth(),[params,setParams]=useSearchParams(),location=useLocation(),navigationType=useNavigationType();
 const employeeId=validId(params.get('employeeId'))?params.get('employeeId'):null;
 const tab=tabs.some(([key])=>key===params.get('tab'))?params.get('tab'):'summary';
 const page=Math.min(100000,Math.max(1,Number(params.get('page'))||1));
 const pageSize=[10,20,50,100].includes(Number(params.get('pageSize')))?Number(params.get('pageSize')):20;
 const status=statuses.includes(params.get('status'))?params.get('status'):'';
 const searchKey=location.state?.employeeRecordSearchKey||null,applied=recallRecordSearch(user.id,searchKey);
 const [draft,setDraft]=useState(applied),[draftLocation,setDraftLocation]=useState(location.key),[draftStatus,setDraftStatus]=useState(status),[revision,setRevision]=useState(0),[result,setResult]=useState(null);
 // Restore Back/Forward snapshots without overwriting edits made while a
 // live search's replacement navigation is still rendering.
 if(draftLocation!==location.key){setDraftLocation(location.key);if(navigationType==='POP'){setDraft(applied);setDraftStatus(status);}}
 const tabList=useRef(null),detailHeading=useRef(null),focusEmployee=useRef(null);
 const key=JSON.stringify([searchKey,applied,status,page,pageSize,revision]);
 const summary=useApiResource(employeeId?employeeRecordPath(employeeId):null);
 useEffect(()=>{if(employeeId)return;const controller=new AbortController();Promise.resolve().then(()=>{if(!controller.signal.aborted)return searchEmployeeRecords({query:applied,status,page,pageSize},getCsrfToken(),controller.signal);}).then(data=>{if(!controller.signal.aborted)setResult({key,data});}).catch(error=>{if(!controller.signal.aborted)setResult({key,error});});return()=>controller.abort();},[key,applied,status,page,pageSize,employeeId,getCsrfToken]);
 useEffect(()=>{if(summary.data?.employee.id===focusEmployee.current){detailHeading.current?.focus();focusEmployee.current=null;}},[summary.data]);
 const current=result?.key===key?result:null,loading=!current;
 function update(changes,replace=false,nextSearchKey=searchKey){const next=new URLSearchParams(window.location.search);for(const [name,value]of Object.entries(changes))if(value===null||value==='')next.delete(name);else next.set(name,String(value));setParams(next,{replace,state:{employeeRecordSearchKey:nextSearchKey}});}
 function search(query,nextStatus){const normalized=query.trim(),live=new URLSearchParams(window.location.search),liveQuery=recallRecordSearch(user.id,window.history.state?.usr?.employeeRecordSearchKey);if(normalized===liveQuery&&nextStatus===(live.get('status')||'')&&Number(live.get('page')||1)===1)return;update({status:nextStatus,page:null,employeeId:null},true,normalized?rememberRecordSearch(user.id,normalized):null);}
 function reset(){setDraft('');setDraftStatus('');setRevision(v=>v+1);update({status:null,page:null,pageSize:null,employeeId:null},false,null);}
 function select(id){focusEmployee.current=id;update({employeeId:id,periodId:null,historyPage:null,paymentPage:null,salaryPage:null,documentPage:null});requestAnimationFrame(()=>detailHeading.current?.focus());}
 function switchTab(value){update({tab:value});}
 function tabKeys(event,index){let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();switchTab(tabs[next][0]);tabList.current?.querySelectorAll('[role="tab"]')[next]?.focus();}
 return <section className="min-w-0 space-y-5">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Employee Records</h1><p className="mt-2 text-sm text-muted-foreground">{employeeId?'Employment history, recorded payments and documents.':'Search current and former employees and open their complete record.'}</p></div><Button variant="outline" disabled={employeeId?summary.loading:loading} onClick={()=>{setRevision(v=>v+1);if(employeeId)void summary.reload().catch(()=>{});}}><RefreshCw aria-hidden="true"/>Refresh records</Button></header>
  {!employeeId&&<form onSubmit={event=>event.preventDefault()} className="grid min-w-0 items-end gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto]">
   <label className="min-w-0 space-y-1.5 text-sm font-medium">Search<div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"/><input className={inputClass+' pl-10'} autoComplete="off" type="search" maxLength={120} aria-label="Search by name, employee code or CNIC" placeholder="Name, employee code or CNIC" value={draft} onChange={e=>{setDraft(e.target.value);search(e.target.value,draftStatus);}}/></div></label>
   <label className="min-w-0 space-y-1.5 text-sm font-medium">Employment status<EmploymentSelect aria-label="Employment status filter" placeholder="All statuses" value={draftStatus} options={statuses.map(s=>[s,readable(s)])} onChange={e=>{setDraftStatus(e.target.value);search(draft,e.target.value);}}/></label><Button variant="outline" className="min-h-11" onClick={reset}>Reset</Button>
  </form>}
  <div className="min-w-0">
   {!employeeId&&<section aria-label="Employee results" className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">Employee directory</h2>{current?.data&&<span className="text-sm text-muted-foreground">{current.data.total} employees</span>}</header>
    {loading?<p role="status" className="p-5 text-sm text-muted-foreground">Loading employee records...</p>:current.error?<div role="alert" className="space-y-3 p-4 text-sm"><p className="break-words text-destructive">{current.error.message}</p><Button variant="outline" onClick={()=>setRevision(v=>v+1)}>Retry employee search</Button></div>:<>
     <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">Joined refers to the latest applicable employment period. Exit date is the recorded official employment end date.</p>
     <div role="region" aria-label="Employee directory table" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"><table className="w-full min-w-[52rem] text-left text-sm"><caption className="sr-only">Current and former employee records</caption><thead className="border-b border-border bg-muted text-muted-foreground"><tr>{['Employee','Department / Team','Joined','Employment status','Exit date','Action'].map(title=><th scope="col" key={title} className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead><tbody className="divide-y divide-border">{current.data.employees.map(person=><tr key={person.id} className="hover:bg-primary/5"><td className="max-w-64 break-words px-4 py-3 font-semibold">{person.fullName}<p className="mt-1 font-normal text-muted-foreground">{person.employeeCode}</p></td><td className="max-w-64 break-words px-4 py-3">{recorded([person.department,person.team].filter(Boolean).join(' / '))}</td><td className="whitespace-nowrap px-4 py-3">{recorded(person.joined)}</td><td className="px-4 py-3"><RecordBadge status={person.status}/></td><td className="whitespace-nowrap px-4 py-3">{recorded(person.exitDate)}</td><td className="px-4 py-3"><Button variant="outline" size="sm" onClick={()=>select(person.id)} aria-label={'View record for '+person.fullName}>View record<ArrowRight aria-hidden="true"/></Button></td></tr>)}</tbody></table></div>
     {!current.data.employees.length&&<p className="p-6 text-center text-sm text-muted-foreground">No matching employees.</p>}
     <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border p-4 text-sm"><p className="text-muted-foreground">Showing {current.data.employees.length?(current.data.page-1)*current.data.pageSize+1:0}–{current.data.employees.length?(current.data.page-1)*current.data.pageSize+current.data.employees.length:0} of {current.data.total} employees</p><div className="flex flex-wrap items-center gap-3"><label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground">Rows per page<EmploymentSelect aria-label="Rows per page" placeholder={null} className="!w-24 shrink-0" value={String(pageSize)} options={[10,20,50,100].map(size=>[String(size),String(size)])} onChange={e=>update({pageSize:e.target.value,page:null})}/></label><span>Page {current.data.page} of {current.data.totalPages}</span><Button variant="outline" size="sm" disabled={current.data.page<=1} onClick={()=>update({page:current.data.page-1})}>Previous</Button><Button variant="outline" size="sm" disabled={current.data.page>=current.data.totalPages} onClick={()=>update({page:current.data.page+1})}>Next</Button></div></footer>
    </>}
   </section>}
   {employeeId&&<section className="min-w-0 space-y-5">
    <Button variant="outline" size="sm" onClick={()=>{update({employeeId:null});requestAnimationFrame(()=>document.querySelector('[aria-label="Search by name, employee code or CNIC"]')?.focus());}}><ArrowLeft aria-hidden="true"/>Back to records</Button>
    <RecordResource resource={summary}>{data=><>
     <header aria-label="Employee identity" className="flex min-w-0 flex-wrap items-start gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5"><InitialsAvatar name={data.employee.fullName}/><div className="min-w-0 flex-1"><h2 ref={detailHeading} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight outline-none">{data.employee.fullName}</h2><div className="mt-2 flex flex-wrap items-center gap-3 text-sm"><span className="break-words font-medium">{data.employee.employeeCode}</span><span className="text-muted-foreground">Employment status:</span><RecordBadge status={data.employee.status}/></div><p className="mt-2 break-words text-sm text-muted-foreground">CNIC: {recorded(data.employee.maskedCnic)}</p><p className="mt-1 break-words text-sm text-muted-foreground">Account status: {data.employee.accountStatus?readable(data.employee.accountStatus):'No linked account'}</p><p className="mt-2 break-words text-sm text-muted-foreground">{[data.placement?.designation,data.placement?.department,data.placement?.team,data.placement?.campaign].filter(Boolean).join(' · ')||'Organization details not recorded'}</p></div></header>
     <div ref={tabList} role="tablist" aria-label="Employee record sections" className="app-tabs">{tabs.map(([value,title],index)=><button type="button" key={value} role="tab" id={'record-tab-'+value} aria-controls="record-panel" aria-selected={tab===value} tabIndex={tab===value?0:-1} onKeyDown={e=>tabKeys(e,index)} onClick={()=>switchTab(value)}>{title}</button>)}</div>
     <div role="tabpanel" id="record-panel" aria-labelledby={'record-tab-'+tab} tabIndex={0} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      {tab==='summary'&&<RecordSummary data={data}/>}{tab==='history'&&<RecordHistory key={employeeId+':'+revision} employeeId={employeeId} params={params} update={update}/>}{tab==='payments'&&<RecordFinances key={employeeId+':'+revision} employeeId={employeeId} params={params} update={update}/>}{tab==='documents'&&<RecordDocuments key={employeeId+':'+revision} employeeId={employeeId} params={params} update={update}/>}
     </div>
    </>}</RecordResource>
   </section>}
  </div>
 </section>;
}

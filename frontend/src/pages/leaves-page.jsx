import {calendarDate,dateTime} from '@/components/payroll/payroll-format';
import {Fragment,useCallback,useEffect,useRef,useState} from 'react';
import {Navigate,useLocation,useSearchParams} from 'react-router';
import {CalendarDays,RefreshCw} from 'lucide-react';
import {useAuth} from '@/context/auth-context';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {leaveRead,leaveWrite} from '@/services/leave.service';
import {karachiMonth} from '@/lib/reports';
import '@/components/self-service-pages.css';

export default function LeavesPage(){
 const {user}=useAuth(),[params]=useSearchParams(),location=useLocation();
 if(user.role==='ADMIN'&&(params.get('view')!=='management'||params.has('reviewableOnly'))){
  const next=new URLSearchParams(params);next.set('view','management');next.delete('reviewableOnly');
  return <Navigate to={{pathname:location.pathname,search:`?${next}`,hash:location.hash}} state={location.state} replace />;
 }
 return <LeaveWorkspace key={user.role==='ADMIN'?`${user.id}:${location.search}`:user.id} user={user}/>;
}
function LeaveWorkspace({user}){
 const {getCsrfToken}=useAuth(),[params,setParams]=useSearchParams();
 const isAdmin=user.role==='ADMIN';

 const canManage=['HR','ADMIN'].includes(user.role);
 const [managementView,setManage]=useState(canManage&&(!!params.get('id')||params.get('view')==='management'));
 const manage=isAdmin||managementView;
 const personalUI=!manage;
 const LeaveContent=personalUI?'div':Fragment;
 const HeaderControls=personalUI?'div':Fragment;
 const [reviewableOnly,setReviewableOnly]=useState(user.role==='HR'&&params.get('reviewableOnly')==='true');
 const [month,setMonth]=useState(()=>canManage&&params.get('view')==='management'&&params.get('allMonths')==='true'?'':isAdmin&&/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month')||'')&&params.get('month')>='1900-01'&&params.get('month')<='9998-12'?params.get('month'):karachiMonth()),[status,setStatus]=useState(()=>['PENDING','APPROVED','REJECTED','CANCELLED'].includes(params.get('status'))?params.get('status'):''),[search,setSearch]=useState(()=>isAdmin?(params.get('search')||'').slice(0,120):''),[employeeId,setEmployeeId]=useState(()=>isAdmin&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.get('employeeId')||'')?params.get('employeeId'):''),[page,setPage]=useState(()=>isAdmin&&/^[1-9]\d{0,5}$/.test(params.get('page')||'')&&Number(params.get('page'))<=100000?Number(params.get('page')):1);
 const [data,setData]=useState(null),[balance,setBalance]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [shiftDate,setDate]=useState(''),[reason,setReason]=useState(''),[detail,setDetail]=useState(null),[actionReason,setActionReason]=useState('');
 const [busy,setBusy]=useState(false),[reconcile,setReconcile]=useState(false);
 const lock=useRef(false),controller=useRef(null),detailRequest=useRef(0),alive=useRef(true);
 const id=params.get('id');
 const dispose=useCallback(()=>{alive.current=false;controller.current?.abort();detailRequest.current++;},[]);
 useEffect(()=>{alive.current=true;return dispose;},[dispose]);
 const load=useCallback(async()=>{
  controller.current?.abort();const ctrl=new AbortController();controller.current=ctrl;
  setLoading(true);setData(null);setBalance(null);setError('');
  try{
   const [list,b]=await Promise.all([leaveRead(manage?'/management':'',{month,status,page,search:manage?search:undefined,employeeId:manage?employeeId:undefined,reviewableOnly:manage&&reviewableOnly?'true':undefined},{signal:ctrl.signal}),manage?Promise.resolve(null):leaveRead('/balance',{month},{signal:ctrl.signal})]);
   if(!ctrl.signal.aborted){setData(list);setBalance(b);return true;}return false;
  }catch(e){if(!ctrl.signal.aborted)setError(e.message);return false;}
  finally{if(!ctrl.signal.aborted)setLoading(false);}
 },[manage,month,status,page,search,employeeId,reviewableOnly]);
 const cancelLoad=useCallback(()=>controller.current?.abort(),[]);
 useEffect(()=>{void load();return cancelLoad;},[load,cancelLoad]);
 const readDetail=useCallback(async()=>{
  const version=++detailRequest.current;if(!id){setDetail(null);return true;}
  setDetail(null);
  try{const result=await leaveRead(`${manage?'/management':''}/${id}`);if(alive.current&&version===detailRequest.current){setDetail(result);setActionReason('');return true;}return false;}
  catch(e){if(alive.current&&version===detailRequest.current)setError(e.message);return false;}
 },[id,manage]);
 const invalidateDetail=useCallback(()=>{detailRequest.current++;},[]);
 useEffect(()=>{void readDetail();return invalidateDetail;},[readDetail,invalidateDetail]);
 async function reload(){const results=await Promise.all([load(),readDetail()]);if(alive.current&&results.every(Boolean)){setReconcile(false);}}
 async function write(path,body,success){
  if(isAdmin||lock.current||reconcile)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await leaveWrite(path,body,{csrfToken:getCsrfToken()});if(!alive.current)return;setNotice(success);if(path===''){setReason('');setDate('');setParams({});setDetail(null);setPage(1);}else if(result.id)setDetail(result);setActionReason('');await load();}
  catch(e){if(alive.current){const uncertain=!e.status||e.status>=500||e.status===409||e.code==='INVALID_RESPONSE';setError(e.message+(uncertain?' Reload saved data before another write.':''));setReconcile(uncertain);}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function tab(value){if(isAdmin)return;setManage(value);setPage(1);setStatus(value?'PENDING':'');setReviewableOnly(false);if(!value&&!month)setMonth(karachiMonth());setParams({});setDetail(null);setError('');}
 function showDetails(nextId){
  if(!isAdmin){setParams(nextId?{id:nextId}:{});return;}
  const next=new URLSearchParams(params);next.set('view','management');next.delete('reviewableOnly');
  for(const [key,value]of Object.entries({id:nextId,month,allMonths:month?'':'true',status,search,employeeId,page:String(page)}))value?next.set(key,value):next.delete(key);
  setParams(next);
 }
 const canSubmit=!!shiftDate&&!!reason.trim()&&(shiftDate.slice(0,7)!==month||balance&&!balance.expired&&balance.available>0);
 const disabled=busy||reconcile;
 return <div className={personalUI?"self-service-page leave-workspace space-y-5":isAdmin?"space-y-8":"space-y-6"}>
  <div className={personalUI?"self-service-page-header leave-page-header":isAdmin?"flex flex-wrap items-center justify-between gap-4":"flex flex-wrap items-center justify-between gap-3"}><div><h1 className={isAdmin?"text-2xl font-semibold tracking-tight text-foreground sm:text-3xl":"flex items-center gap-2 text-2xl font-semibold tracking-tight leading-tight sm:text-3xl"}>{!isAdmin&&<CalendarDays aria-hidden="true" className="size-6"/>}{isAdmin?'Leave Overview':personalUI?'My Paid Leave':'Leave Management'}</h1><p className={isAdmin?"mt-1 text-sm text-muted-foreground":"mt-1 text-sm text-muted-foreground"}>{personalUI?'Manage your leave balance and track your requests.':'One paid full day per calendar month, in Asia/Karachi.'}</p></div><HeaderControls {...(personalUI?{className:"leave-header-controls"}:{})}><Button variant="outline" onClick={reload} disabled={busy}><RefreshCw aria-hidden="true" className="size-4"/>{personalUI?"Refresh":"Reload saved data"}</Button>{personalUI&&<details className="self-service-guide quiet-disclosure"><summary>Leave policy</summary><div><p>Unused leave expires at month-end. No carry-forward, borrowing, extra days, half-days or unpaid leave. A pending request reserves your month. HR reviews requests; payroll remains manual.</p><p>The date covers 7 PM to 5 AM the next morning. Friday belongs to Friday's month. Weekends and announced holidays are excluded.</p></div></details>}</HeaderControls></div>
  {!personalUI&&!isAdmin&&<p className="rounded-xl border bg-card p-4 text-sm">Unused leave expires at month-end. No carry-forward, borrowing, extra days, half-days or unpaid leave. A pending request reserves your month. HR reviews requests; payroll remains manual.</p>}
  {canManage&&!isAdmin&&<div className="app-tabs" role="group" aria-label="Leave view"><Button variant={!manage?'default':'outline'} aria-pressed={!manage} onClick={()=>tab(false)} disabled={busy}>My leave</Button><Button variant={manage?'default':'outline'} aria-pressed={manage} onClick={()=>tab(true)} disabled={busy}>{user.role==='HR'?'HR leave queue':'Read-only oversight'}</Button></div>}
  {error&&<p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="rounded-xl border p-3 text-sm">{notice}</p>}
  {reconcile&&<p role="status" className="text-sm">Writes are locked until you reload saved data. Your entered reason is preserved. An unconfirmed write is never retried automatically.</p>}
  {manage&&<div className="flex flex-wrap items-center gap-3 text-sm"><span>{month?`Leave month: ${month}`:'All leave months'}</span><Button variant="outline" onClick={()=>{setMonth('');setPage(1);}} disabled={busy}>Show all leave months</Button>{user.role==='HR'&&<label><input type="checkbox" aria-label="Only requests I can review" checked={reviewableOnly} onChange={e=>{setReviewableOnly(e.target.checked);setPage(1);}}/> Only requests I can review (pending, excluding self)</label>}</div>}
  <div className={personalUI?"self-service-filters":isAdmin?"grid gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-xs sm:grid-cols-3 sm:p-5":"flex flex-wrap gap-4"}><label className={isAdmin?"min-w-0 text-sm font-medium normal-case tracking-normal text-muted-foreground":"text-sm font-medium"}>Selected month<Input className={isAdmin?"mt-1 h-9 w-full text-sm font-normal normal-case tracking-normal text-foreground":undefined} type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}} aria-label="Selected month"/></label><label className={isAdmin?"min-w-0 text-sm font-medium normal-case tracking-normal text-muted-foreground":"text-sm font-medium"}>Request status<select className={isAdmin?"mt-1 block h-9 w-full rounded-lg border border-input bg-background/80 px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-foreground shadow-2xs focus-visible:outline-2 focus-visible:outline-ring":"mt-1 block rounded-lg border bg-background p-2"} aria-label="Request status" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{['PENDING','APPROVED','REJECTED','CANCELLED'].map(s=><option key={s}>{s}</option>)}</select></label>
  {manage&&<><label className={isAdmin?"min-w-0 text-sm font-medium normal-case tracking-normal text-muted-foreground":"text-sm font-medium"}>Employee name or code<Input className={isAdmin?"mt-1 h-9 w-full text-sm font-normal normal-case tracking-normal text-foreground":undefined} aria-label="Employee name or code" value={search} maxLength={120} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>{!isAdmin&&<label className="text-sm font-medium">Employee ID filter<Input aria-label="Employee ID filter" value={employeeId} placeholder="Optional employee UUID" onChange={e=>{setEmployeeId(e.target.value);setPage(1);}}/></label>}</>}</div>
  {balance&&<><dl className={personalUI?"leave-balance-strip":"grid grid-cols-2 gap-3 lg:grid-cols-4"} aria-label="Monthly paid leave balance">{[['Monthly Allowance',balance.allowance],['Available Leave',balance.available],['Pending',balance.reserved],['Approved',balance.used]].map(([label,value])=><div key={label} className="rounded-xl border bg-card p-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 text-2xl font-semibold">{value} <span className="text-xs">{value===1?'day':'days'}</span></dd></div>)}</dl>{balance.expired&&<p className="text-sm">This month has expired; unused leave cannot be requested.</p>}{balance.eligibleReviewerCount===0&&<p role="status" className="rounded-lg border p-3 text-sm">No other eligible HR reviewer is available. Contact HR. Admin cannot approve leave.</p>}</>}
  <LeaveContent {...(personalUI?{className:"space-y-4"}:{})}>
  {!isAdmin&&!manage&&balance&&<form className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" onSubmit={e=>{e.preventDefault();if(canSubmit)void write('',{shiftDate,reason},'Leave request submitted for HR review.');}}><h2 className="text-lg font-semibold">Request Leave</h2><label className="block text-sm font-medium">Leave Date<Input aria-label="Leave Date" type="date" required value={shiftDate} onChange={e=>setDate(e.target.value)} disabled={disabled}/></label><label className="block text-sm font-medium">Reason<textarea aria-label="Leave reason" placeholder="Add a reason for your leave request" required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} disabled={disabled} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3 text-sm"/></label><Button type="submit" disabled={disabled||!canSubmit}>{busy?'Submitting...':'Submit Leave Request'}</Button></form>}
  {!manage?<section aria-label="Leave requests" className="min-w-0 overflow-hidden rounded-xl border bg-card"><header className="border-b p-4"><h2 className="text-lg font-semibold">My Leave Requests</h2></header><div role="region" aria-label="My leave request history" tabIndex={0} className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"><table className="w-full min-w-[40rem] table-auto text-left text-sm"><thead className="border-b bg-muted/40 text-muted-foreground"><tr>{['Leave Date','Days','Reason','Requested On','Status','Actions'].map(label=><th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y">{!loading&&data?.requests.map(r=><tr key={r.id}><td className="whitespace-nowrap px-4 py-3">{calendarDate(r.shiftDate)}</td><td className="px-4 py-3">{r.days}</td><td className="max-w-xs whitespace-pre-wrap break-words px-4 py-3">{r.reason}</td><td className="whitespace-nowrap px-4 py-3">{dateTime(r.createdAt)}</td><td className="px-4 py-3"><Badge variant="outline">{r.status.charAt(0)+r.status.slice(1).toLowerCase()}</Badge></td><td className="px-4 py-3"><Button variant="outline" aria-label={`View leave ${r.shiftDate}`} onClick={()=>showDetails(r.id)} disabled={busy}>View request</Button></td></tr>)}</tbody></table></div>{loading?<p role="status" className="p-5 text-sm">Loading leave requests...</p>:!data?.requests.length&&<p className="p-5 text-center text-sm text-muted-foreground">{error?'Leave data unavailable. Reload to retry.':month&&!status?'No leave requests this month.':'No leave requests match these filters.'}</p>}{data?.totalPages>1&&<footer className="flex flex-wrap items-center gap-3 border-t p-4 text-sm"><Button variant="outline" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page} of {data.totalPages}</span><Button variant="outline" disabled={loading||page>=data.totalPages} onClick={()=>setPage(p=>p+1)}>Next</Button></footer>}</section>:isAdmin ? <section aria-label="Leave requests" className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
    <div className="border-b border-border/80 p-4 sm:p-5"><h2 className="text-lg font-semibold tracking-tight text-foreground">Management requests</h2></div>
    <div role="region" aria-label="Management leave requests" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead className="border-b border-border/80 bg-muted/40 text-sm font-semibold normal-case tracking-normal text-muted-foreground">
          <tr>{['Employee','Leave Date','Leave Duration','Month','Status','Action'].map(label=><th key={label} scope="col" className="px-4 py-2.5 font-semibold">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {!loading && data?.requests.map(r=><tr key={r.id} className="hover:bg-muted/30 transition-colors">
              <td className="max-w-xs break-words px-4 py-3 text-sm font-semibold text-foreground"><div>{r.employee.fullName}</div><div className="font-mono text-xs font-normal text-muted-foreground">{r.employee.employeeCode}</div></td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.shiftDate}</td>
              <td className="px-4 py-3 text-sm">1 paid full day</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.month}</td>
              <td className="px-4 py-3"><Badge variant="outline" className="border-border bg-muted/60 text-muted-foreground">{r.status}</Badge></td>
              <td className="px-4 py-3"><Button variant="outline" aria-label={`View leave ${r.shiftDate}`} onClick={()=>showDetails(r.id)} disabled={busy}>View request</Button></td>
            </tr>)}
        </tbody>
      </table>
    </div>
    {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading leave requests...</p> : !data?.requests.length && <p className="py-8 text-center text-xs text-muted-foreground">{error?'Leave data unavailable. Reload to retry.':'No requests match this month and status.'}</p>}
    <footer className="flex flex-wrap items-center gap-3 border-t border-border/80 p-4 text-sm sm:p-5"><Button variant="outline" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page} of {data?.totalPages||1}</span><Button variant="outline" disabled={loading||page>=(data?.totalPages||1)} onClick={()=>setPage(p=>p+1)}>Next</Button></footer>
  </section> : <section aria-label="Leave requests" className={personalUI?"leave-request-history space-y-3":"space-y-3"}><h2 className="text-lg font-semibold">{manage?'Management requests':'My requests'}</h2>{loading?<p role="status">Loading leave requests...</p>:!data?.requests.length?<p className="rounded-xl border p-5 text-sm">{error?'Leave data unavailable. Reload to retry.':personalUI?<span className="leave-empty"><CalendarDays aria-hidden="true"/><strong>{month&&!status?"No requests this month":"No requests match these filters"}</strong><span>Your submitted requests will appear here.</span></span>:'No requests match this month and status.'}</p>:<ul className="grid gap-3 md:grid-cols-2">{data.requests.map(r=><li key={r.id} className="rounded-xl border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{r.shiftDate}</span><span className="rounded-full border px-2 py-1 text-xs">{r.status}</span></div>{manage&&<p className="mt-2 text-sm">{r.employee.fullName} ({r.employee.employeeCode})</p>}<p className="my-2 text-sm text-muted-foreground">1 paid full day · {r.month}</p><Button variant="outline" aria-label={`View leave ${r.shiftDate}`} onClick={()=>showDetails(r.id)} disabled={busy}>View request</Button></li>)}</ul>}<div className="flex items-center gap-3"><Button variant="outline" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span className="text-sm">Page {page} of {data?.totalPages||1}</span><Button variant="outline" disabled={loading||page>=(data?.totalPages||1)} onClick={()=>setPage(p=>p+1)}>Next</Button></div></section>}
  </LeaveContent>
  {personalUI&&<p className="text-xs text-muted-foreground">Unused leave expires at month-end.</p>}
  {detail&&<section aria-label="Leave request details" className="space-y-4 rounded-xl border bg-card p-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-semibold">Leave on {detail.shiftDate}</h2><Button variant="outline" onClick={()=>showDetails(null)}>Close details</Button></div><p>{detail.employee.fullName} · {detail.status} · 1 paid full day · version {detail.version}</p><p className="whitespace-pre-wrap break-words text-sm">Reason: {detail.reason}</p>{detail.eligibility&&<div className="rounded-lg border p-3 text-sm"><p>Current date check: {detail.eligibility.issues.length?detail.eligibility.issues.join(', '):'Eligible'}.</p>{detail.eligibility.attendanceWarning&&<p>{detail.eligibility.attendanceWarning}</p>}<p>Later calendar conflicts preserve the approved request and its approved leave allocation. HR can cancel a future approved request with a reason; a started shift needs an explicit business resolution.</p></div>}
   {detail.eligibleReviewerCount===0&&detail.status==='PENDING'&&<p role="status">No eligible HR reviewer. Another HR account is required.</p>}
   <h3 className="font-semibold">Decision history</h3><ol className="space-y-2">{detail.history.map(h=><li key={h.version} className="rounded-lg border p-3 text-sm"><p>{h.action} · version {h.version} · {new Date(h.at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})} PKT</p><p className="break-words">Actor: {h.actorName}</p><p className="whitespace-pre-wrap break-words">{h.reason}</p></li>)}</ol>
   {!isAdmin&&(detail.canWithdraw||detail.canReview||detail.canCancel)&&<><label className="block text-sm font-medium">Decision or cancellation reason<textarea aria-label="Decision or cancellation reason" required maxLength={1000} value={actionReason} onChange={e=>setActionReason(e.target.value)} disabled={disabled} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3"/></label><div className="flex flex-wrap gap-3">{detail.canReview&&<><Button disabled={disabled||!actionReason.trim()||detail.eligibility&&!detail.eligibility.eligible} onClick={()=>write(`/${detail.id}/review`,{expectedVersion:detail.version,reason:actionReason,decision:'APPROVED'},'Leave approved.')}>Approve leave</Button><Button variant="outline" disabled={disabled||!actionReason.trim()} onClick={()=>write(`/${detail.id}/review`,{expectedVersion:detail.version,reason:actionReason,decision:'REJECTED'},'Leave rejected; monthly slot released.')}>Reject leave</Button></>}{detail.canWithdraw&&<Button variant="outline" disabled={disabled||!actionReason.trim()} onClick={()=>write(`/${detail.id}/withdraw`,{expectedVersion:detail.version,reason:actionReason},'Pending leave withdrawn; monthly slot released.')}>Withdraw pending request</Button>}{detail.canCancel&&<Button variant="outline" disabled={disabled||!actionReason.trim()} onClick={()=>write(`/${detail.id}/cancel`,{expectedVersion:detail.version,reason:actionReason},'Approved leave cancelled; monthly slot released.')}>Cancel approved future leave</Button>}</div></>}
  </section>}
 </div>;
}

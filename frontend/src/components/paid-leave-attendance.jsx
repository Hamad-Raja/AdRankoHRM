import {useEffect,useState} from 'react';
import {useAuth} from '@/context/auth-context';
import {getReport} from '@/services/reports.service';
import {karachiMonth} from '@/lib/reports';
import {Input} from '@/components/ui/input';

// Uses the existing dated employee/team report scope. Never fetches private reasons.
export default function PaidLeaveAttendance(){
 const {user}=useAuth();const [month,setMonth]=useState(karachiMonth),[data,setData]=useState(null),[error,setError]=useState(''),[page,setPage]=useState(1);
 useEffect(()=>{const ctrl=new AbortController();void getReport('attendance',new URLSearchParams({month,status:'PAID_LEAVE',page:String(page),pageSize:'20'}).toString(),{signal:ctrl.signal}).then(result=>{if(!ctrl.signal.aborted){setData({ownerId:user.id,month,page,...result});setError('');}}).catch(e=>{if(!ctrl.signal.aborted)setError(e.message);});return()=>ctrl.abort();},[month,page,user.id]);
 const current=data?.ownerId===user.id&&data.month===month&&data.page===page?data:null;
 return <section aria-label="Approved paid leave attendance" className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">Approved paid leave</h2><p className="text-sm text-muted-foreground">Full-day leave is separate from worked days and punches. Attendance scope applies; private reasons are omitted. Payroll remains manual.</p><label className="text-sm">Leave attendance month<Input type="month" aria-label="Leave attendance month" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}}/></label>{error?<p role="alert">{error}</p>:!current?<p role="status">Loading approved leave...</p>:!current.rows.length?<p className="text-sm">No approved paid leave in this scope and month.</p>:<ul className="space-y-2">{current.rows.map(r=><li key={`${r.employee.id}:${r.shiftDate}`} className="rounded-lg border p-3 text-sm">{r.shiftDate} · {r.employee.fullName} · 1 paid leave day. No punches created.{r.leaveConflict&&' Calendar/employment conflict: HR review required.'}{r.scheduleState==='SETUP_REQUIRED'&&' Attendance setup required; leave remains recorded.'}</li>)}</ul>}<div className="flex gap-4 text-sm"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous leave page</button><span>Page {page}</span><button disabled={!current||page>=current.totalPages} onClick={()=>setPage(p=>p+1)}>Next leave page</button></div></section>;
}

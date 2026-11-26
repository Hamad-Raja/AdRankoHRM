import {UsersRound,FileText,Clock3,Wallet,CheckCircle2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {payrollQuery,payrollRequest} from '@/services/payroll.service';
import {usePayrollResource} from './use-payroll-resource';
import {salaryForMonth,preparationMonth} from './payroll-format';

// Presentation of existing server records only; mutation endpoints revalidate
// versions, distinct approvers and the applicable salary when confirming.
export function useAdminPayrollActions(record,user,refreshKey=0) {
  const admin=user.role==='ADMIN',review=admin&&record.status==='HR_APPROVED';
  const salary=usePayrollResource(review?'/salaries/'+record.employeeId:null,payrollRequest,`${record.id}:${record.version}:${refreshKey}`);
  const validVersion=Number.isInteger(record.version)&&record.version>0&&record.version<2147483647;
  const blockers=[];
  if(admin&&['HR_APPROVED','APPROVED'].includes(record.status)&&!validVersion)blockers.push('Revision limit reached or saved version unavailable.');
  if(review){
    if(record.hrApprovedByUserId===user.id)blockers.push('A different Admin must give final approval.');
    if(!record.hrApprovedByUserId)blockers.push('Saved HR approver could not be verified.');
    if(salary.loading)blockers.push('Checking the applicable salary...');
    else if(salary.error)blockers.push('Applicable salary unavailable. Retry the salary check.');
    else if(!Array.isArray(salary.data?.versions))blockers.push('Applicable salary could not be verified.');
    else if(salaryForMonth(salary.data,record.month)?.id!==record.salaryVersionId)blockers.push('Salary changed or unavailable. Send back to HR for correction.');
  }
  if(admin&&record.status==='APPROVED'&&record.payment!==null)blockers.push('Payment state changed or could not be verified. Reload saved data.');
  const canApprove=review&&blockers.length===0;
  const canPay=admin&&record.status==='APPROVED'&&blockers.length===0;
  return {canApprove,canPay,canReturn:review&&validVersion,blockers,salary,
    label:review?(canApprove?'Review & Approve':'Review'):canPay?'Record Payment':'View'};
}

export function AdminPayrollAction({record,user,busy,uncertain,refreshKey,onOpen}) {
  const action=useAdminPayrollActions(record,user,refreshKey);
  return <div className="min-w-44 space-y-2">
    <Button variant="outline" size="sm" disabled={busy} aria-label={`${action.label} payroll ${record.month} for ${record.employeeName}`}
      onClick={()=>onOpen(record,action.canPay&&!uncertain?'pay':null)}>{action.label}</Button>
    {action.blockers.length>0&&<p className="max-w-64 text-xs text-muted-foreground">{action.blockers.join(' ')}</p>}
    {action.salary.error&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void action.salary.reload().catch(()=>{})}>Retry salary check</Button>}
  </div>;
}

export function MonthlyPayrollPaymentAction({record,user,busy,uncertain,onOpen}) {
  const action=useAdminPayrollActions(record,user);
  const canView=['ADMIN','HR'].includes(user.role)&&record.status==='PAID'&&Boolean(record.payment);
  if(!action.canPay&&!canView)return null;
  return <Button variant="outline" size="sm" disabled={busy||(action.canPay&&uncertain)}
    onClick={()=>onOpen(record,action.canPay?'pay':'payment')} aria-label={action.canPay?'Record payment':`View payment for ${record.employeeName} ${record.month}`}>{action.canPay?'Record payment':'View payment'}</Button>;
}

function PayrollCountCard({label,count,loading,error,onRetry,Icon}) {
 const valid=Number.isSafeInteger(count)&&count>=0;
 return <div aria-label={label} className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4"><Icon aria-hidden="true" className="mt-1 size-6 shrink-0 text-muted-foreground"/><div className="min-w-0"><p className="break-words text-xl font-semibold tabular-nums" aria-live="polite">{loading?'Loading...':error||!valid?'Unavailable':count}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p>{(error||!loading&&!valid)&&<Button type="button" variant="outline" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal" onClick={onRetry}>Retry {label.toLowerCase()}</Button>}</div></div>;
}
function PayrollCountScope({month}){return <p className="text-xs text-muted-foreground">{month?preparationMonth(month):'All payroll months'} · All statuses · Matches employee search</p>;}
export function MonthlyPayrollSummary({resource,month}) {
 return <section aria-label="Monthly payroll counts" className="space-y-2"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[['Employees in payroll','employees',UsersRound],['Not prepared','notPrepared',FileText],['Pending approval','pendingApproval',Clock3],['Awaiting payment','awaitingPayment',Wallet],['Paid','paid',CheckCircle2]].map(([label,key,Icon])=><PayrollCountCard key={key} label={label} Icon={Icon} count={resource.data?.summary?.[key]} loading={resource.loading} error={resource.error} onRetry={()=>void resource.reload().catch(()=>{})}/>)}</div><PayrollCountScope month={month}/><p className="text-xs text-muted-foreground">Pending approval: HR-approved payroll awaiting Admin decision. Drafts, returned payroll and salary setup required are separate states.</p></section>;
}
export function AdminPayrollSummary({month,search,revision}) {
 return <section aria-label="Payroll approval counts" className="space-y-2"><div className="grid gap-3 sm:grid-cols-3">{[['Awaiting Admin approval','HR_APPROVED',Clock3],['Awaiting payment','APPROVED',Wallet],['Paid','PAID',CheckCircle2]].map(([label,status,Icon])=><SummaryCount key={status} label={label} Icon={Icon} month={month} search={search} status={status} revision={revision}/>)}</div><PayrollCountScope month={month}/></section>;
}
function SummaryCount({label,month,search,status,revision,Icon}) {
 const resource=usePayrollResource('?'+payrollQuery({month,search,status,page:1,pageSize:1}),payrollRequest,revision);
 return <PayrollCountCard label={label} Icon={Icon} count={resource.data?.total} loading={resource.loading} error={resource.error} onRetry={()=>void resource.reload().catch(()=>{})}/>;
}

import {Button} from '@/components/ui/button';
import {payrollQuery,payrollRequest} from '@/services/payroll.service';
import {usePayrollResource} from './use-payroll-resource';
import {salaryForMonth} from './payroll-format';

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
    onClick={()=>onOpen(record,action.canPay?'pay':null)}>{action.canPay?'Record payment':'View payment'}</Button>;
}

export function AdminPayrollSummary({month,search,revision}) {
  return <section aria-label="Payroll approval counts" className="space-y-2">
    <p className="text-xs text-muted-foreground">Full totals across statuses for {month||'all payroll months'} and the current employee search.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {[['Awaiting Approval','HR_APPROVED'],['Awaiting Payment','APPROVED'],['Paid','PAID']].map(([label,status])=>
        <SummaryCount key={status} label={label} month={month} search={search} status={status} revision={revision}/>)}
    </div>
  </section>;
}
function SummaryCount({label,month,search,status,revision}) {
  const resource=usePayrollResource('?'+payrollQuery({month,search,status,page:1,pageSize:1}),payrollRequest,revision);
  const count=resource.data?.total,valid=Number.isSafeInteger(count)&&count>=0;
  return <div className="min-w-0 rounded-xl border border-border bg-card p-4">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="mt-1 text-xl font-semibold tabular-nums" aria-live="polite">{resource.loading?'Loading...':resource.error||!valid?'Unavailable':count}</p>
    {(resource.error||!resource.loading&&!valid)&&<Button variant="outline" size="sm" onClick={()=>void resource.reload().catch(()=>{})}>Retry {label.toLowerCase()}</Button>}
  </div>;
}

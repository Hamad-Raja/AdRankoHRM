import {useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router';
import {UserRound, History, Plus, RefreshCw} from 'lucide-react';
import {useAuth} from '@/context/auth-context';
import {Button} from '@/components/ui/button';
import {ApiError} from '@/lib/api';
import {payrollRequest, payrollQuery} from '@/services/payroll.service';
import {usePayrollResource} from '@/components/payroll/use-payroll-resource';
import {PayrollField, PayrollStatus} from '@/components/payroll/payroll-fields';
import {currentMonth, dateTime, inputClass, pkr, readable} from '@/components/payroll/payroll-format';
import SalaryRevisionDialog from '@/components/payroll/salary-revision-dialog';
import PayrollDraftDialog from '@/components/payroll/payroll-draft-dialog';
import EmployeeCombobox from '@/components/payroll/employee-combobox';
import PayrollDetailsDialog from '@/components/payroll/payroll-details-dialog';
import payrollPrintStyles from '@/components/payroll/payroll-print.css?inline';

const monthPattern=/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function PayrollWorkspace({own}) {
  const {user,getCsrfToken,refreshSession}=useAuth();
  const [query]=useSearchParams();
  const requestedId=idPattern.test(query.get('payrollId')||'')?query.get('payrollId'):null;
  const [month,setMonth]=useState(()=>monthPattern.test(query.get('month')||'')?query.get('month'):requestedId?'':currentMonth());
  const [status,setStatus]=useState(()=>(own?['APPROVED','PAID']:['DRAFT','HR_APPROVED','APPROVED','PAID']).includes(query.get('status'))?query.get('status'):'');
  const [search,setSearch]=useState(''), [page,setPage]=useState(1), [selected,setSelected]=useState(null);
  const [selection,setSelection]=useState({query:requestedId,id:requestedId});
  const detailId=selection.query===requestedId?selection.id:requestedId;
  const [modal,setModal]=useState(null), [busy,setBusy]=useState(false), [uncertain,setUncertain]=useState(false), [writeError,setWriteError]=useState(null), [notice,setNotice]=useState('');
  const alive=useRef(true), writeLock=useRef(false), writeController=useRef(null);
  const [detailOpener,setDetailOpener]=useState(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;writeController.current?.abort();};},[]);
  const salary=usePayrollResource(!own&&selected?'/salaries/'+selected.id:null);
  const records=usePayrollResource((own?'/payslips':'')+'?'+payrollQuery({month,status,search,page,pageSize:20,employeeId:own?'':selected?.id||''}));
  const detail=usePayrollResource(detailId?(own?'/payslips/':'/')+detailId:null);
  const currentEmployee=salary.data?.employee||selected;
  const currentSalary=salary.data?.versions.find(version=>version.effectiveMonth<=currentMonth())||null;
  const rowEmployee=record=>({id:record.employeeId,fullName:record.employeeName,employeeCode:record.employeeCode});
  const readFailure=records.error||salary.error||detail.error;
  useEffect(()=>{if(readFailure&&(readFailure.status===401||readFailure.code==='PASSWORD_CHANGE_REQUIRED'))void refreshSession();},[readFailure,refreshSession]);

  function choose(employee){setSelected(employee);setSelection({query:requestedId,id:null});setPage(1);setWriteError(null);setNotice('');}
  function openRecord(record){setDetailOpener(document.activeElement);setSelection({query:requestedId,id:record.id});setWriteError(null);}
  function openModal(type,record=null){
    setWriteError(null);setNotice('');
    if(record)setModal({type:'draft',employee:rowEmployee(record),record,returnFocus:detailId?detailOpener:document.activeElement});
    else if(currentEmployee)setModal({type,employee:currentEmployee,record:null,returnFocus:document.activeElement});
  }
  async function reload() {
    if(writeLock.current)return false;
    writeLock.current=true;setBusy(true);setWriteError(null);
    try{
      await Promise.all([records.reload(),salary.reload(),detail.reload()]);
      if(!alive.current)return false;
      setUncertain(false);setModal(null);setNotice('Saved records reloaded. Check history before submitting another action.');return true;
    }catch(error){if(alive.current)setWriteError(error);return false;}
    finally{writeLock.current=false;if(alive.current)setBusy(false);}
  }
  async function write(path,body,method='POST') {
    if(writeLock.current||uncertain)return null;
    writeLock.current=true;setBusy(true);setWriteError(null);setNotice('');
    const controller=new AbortController();writeController.current=controller;
    let started=false,saved=null,confirmed=false;
    try{
      const csrfToken=getCsrfToken();started=true;
      saved=await payrollRequest(path,{method,body,csrfToken,signal:controller.signal});
      if(!saved?.id)throw new ApiError('The write outcome is unconfirmed. Reload saved data before another submission.',{code:'INVALID_RESPONSE'});
      confirmed=true;
      if(!alive.current||controller.signal.aborted)return null;
      await Promise.all([records.reload(),salary.reload(),detailId===saved.id?detail.reload():Promise.resolve()]);
      if(!alive.current||controller.signal.aborted)return null;
      if(saved.month){if(!detailId)setDetailOpener(modal?.returnFocus||document.activeElement);setSelection({query:requestedId,id:saved.id});setMonth(saved.month);setPage(1);}
      setNotice(path.startsWith('/salaries/')?'Salary change saved. Previous salaries remain in history.':method==='PATCH'?'Draft changes saved successfully.':'Saved successfully.');
      return saved;
    }catch(error){
      if(!alive.current||controller.signal.aborted)return null;
      const unconfirmed=started&&(confirmed||!error.status||error.status>=500||error.status===409||error.code==='INVALID_RESPONSE');
      if(unconfirmed)setUncertain(true);
      setWriteError(confirmed?new Error('Saved successfully, but the saved view could not be refreshed. Reload saved data before another action.'):unconfirmed&&error.status!==409?new Error('The write outcome is unconfirmed. Reload saved data before another submission. No automatic retry was sent.'):error);
      if(error.status===401||error.status===403||error.code==='PASSWORD_CHANGE_REQUIRED')void refreshSession();
      return null;
    }finally{writeLock.current=false;if(alive.current)setBusy(false);}
  }
  const rows=records.data?.records||[];
  return <div className="payroll-screen min-w-0 space-y-6">
    <style>{payrollPrintStyles}</style>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{own?'My Payslips':'Payroll Management'}</h1><p className="mt-2 text-sm text-muted-foreground">{own?'Review your finally approved and paid payslips.':'Select an employee, review salary history, and prepare payroll for approval.'}</p></div><Button variant="outline" disabled={busy} onClick={()=>void reload()}><RefreshCw aria-hidden="true"/>Reload saved data</Button></header>
    {notice&&<p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">{notice}</p>}
    {writeError&&!modal&&<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{writeError.message}</p>}
    {uncertain&&!modal&&<p role="alert" className="text-sm text-muted-foreground">Reload saved data before another write. No automatic retry was sent.</p>}
    {!own&&<section aria-label="Employee selection" className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><UserRound aria-hidden="true" className="size-5"/></span><div><h2 className="text-lg font-semibold">Employee Selection</h2><p className="text-sm text-muted-foreground">Choose an employee to manage salary and monthly payroll.</p></div></div>
      <EmployeeCombobox selected={selected} onSelect={choose} disabled={busy||uncertain}/>
      {currentEmployee&&<div className="rounded-lg bg-background/50 p-3"><p className="break-words font-medium">{currentEmployee.fullName} <span className="text-sm text-muted-foreground">· {currentEmployee.employeeCode}</span></p>{currentEmployee.organization&&<p className="mt-1 text-sm text-muted-foreground">{[currentEmployee.organization.department,currentEmployee.organization.designation].filter(Boolean).join(' · ')}</p>}</div>}
    </section>}
    {!own&&selected&&<section aria-label="Employee salary" className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Employee Salary</h2><p className="mt-1 text-sm">{currentEmployee.fullName} · {currentEmployee.employeeCode}</p><p className="mt-1 text-sm text-muted-foreground">Salary changes and their effective months are retained.</p></div><Button disabled={busy||uncertain||!salary.data} onClick={()=>openModal('salary')}><History aria-hidden="true"/>Revise Pay</Button></div>
      {salary.loading?<p role="status" className="text-sm text-muted-foreground">Loading salary history…</p>:salary.error?<p role="alert" className="text-sm text-destructive">Salary history unavailable: {salary.error.message}</p>:salary.data&&<><dl className="grid min-w-0 gap-5 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Current Monthly Basic Salary</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{currentSalary?pkr(currentSalary.monthlyBasic):'Not set'}</dd></div><div><dt className="text-sm text-muted-foreground">Current Effective Salary Month</dt><dd className="mt-1 font-semibold">{currentSalary?.effectiveMonth||'Not set'}</dd>{salary.data.versions[0]?.effectiveMonth>currentMonth()&&<p className="mt-1 text-xs text-muted-foreground">Future salary changes are listed below.</p>}</div></dl>
      {salary.data.versions.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-muted-foreground"><tr>{['Effective Month','Monthly Basic','Change','Reason'].map(label=><th key={label} scope="col" className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{salary.data.versions.map(version=><tr key={version.id} className="border-b border-border last:border-0"><td className="px-3 py-3"><p>{version.effectiveMonth}</p><p className="text-xs text-muted-foreground">Change {version.revision}</p></td><td className="whitespace-nowrap px-3 py-3 font-medium tabular-nums">{pkr(version.monthlyBasic)}</td><td className="whitespace-nowrap px-3 py-3 tabular-nums">{version.changeAmount?pkr(version.changeAmount):'—'}</td><td className="min-w-36 break-words px-3 py-3 text-muted-foreground">{version.reason}</td></tr>)}</tbody></table></div>:<p className="text-sm text-muted-foreground">No salary history yet. Use Revise Pay to save the first effective salary.</p>}</>}
    </section>}
    <section aria-label="Payroll records" className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{own?'Approved & Paid Payslips':'Monthly Payroll'}</h2><p className="mt-1 text-sm text-muted-foreground">{own?'Only your final payslips are available here.':selected?'Drafts, approvals and payment history for the selected employee.':'Review payroll records across employees, or select an employee to prepare a draft.'}</p></div>{!own&&user.role==='HR'&&<Button disabled={busy||uncertain||!salary.data?.versions.length} onClick={()=>openModal('draft')}><Plus aria-hidden="true"/>Prepare Draft</Button>}</div>
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-3"><PayrollField label="Filter payroll month"><input className={inputClass} type="month" value={month} onChange={event=>{setMonth(event.target.value);setPage(1);}}/></PayrollField><PayrollField label="Filter status"><select className={inputClass} value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">All statuses</option>{(own?['APPROVED','PAID']:['DRAFT','HR_APPROVED','APPROVED','PAID']).map(value=><option key={value} value={value}>{readable(value)}</option>)}</select></PayrollField><PayrollField label="Payroll employee search"><input className={inputClass} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Employee name or code"/></PayrollField></fieldset>
      {records.loading?<p role="status" className="py-4 text-sm text-muted-foreground">Loading payroll…</p>:records.error?<p role="alert" className="py-4 text-sm text-destructive">Payroll data unavailable. Reload saved data to retry. {records.error.message}</p>:rows.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-muted-foreground"><tr>{['Employee','Month','Payable Days','Worked Days','Status',...(!own?['Last Updated']:[]),'Net Pay','Actions'].map(label=><th key={label} scope="col" className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody>{rows.map(record=><tr className="border-b border-border last:border-0" key={record.id}><td className="min-w-36 px-3 py-3"><p className="font-medium">{record.employeeName}</p><p className="text-xs text-muted-foreground">{record.employeeCode}</p></td><td className="px-3 py-3">{record.month}</td><td className="px-3 py-3 tabular-nums">{record.totalPayableDays}</td><td className="px-3 py-3 tabular-nums">{record.workedDays}</td><td className="px-3 py-3"><PayrollStatus status={record.status} needsCorrection={record.needsCorrection}/></td>{!own&&<td className="min-w-36 px-3 py-3 text-xs text-muted-foreground">{dateTime(record.updatedAt)}</td>}<td className="whitespace-nowrap px-3 py-3 font-medium tabular-nums">{pkr(record.netPay)}</td><td className="px-3 py-3"><div className="flex gap-2"><Button variant="outline" disabled={busy} aria-label={`View ${own?'payslip':'payroll'} ${record.month} for ${record.employeeName}`} onClick={()=>openRecord(record)}>View</Button>{!own&&user.role==='HR'&&record.status==='DRAFT'&&<Button variant="outline" disabled={busy||uncertain} aria-label={`Edit draft ${record.month} for ${record.employeeName}`} onClick={()=>openModal('draft',record)}>Edit</Button>}</div></td></tr>)}</tbody></table></div>:<p className="py-6 text-center text-sm text-muted-foreground">{own?'No final payslips found for these filters.':'No payroll records found for these filters.'}</p>}
      {!records.error&&records.data&&<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm"><span>Page {page} of {Math.max(1,records.data.totalPages)}</span><div className="flex gap-2"><Button variant="outline" disabled={busy||page<=1} onClick={()=>setPage(value=>value-1)}>Previous</Button><Button variant="outline" disabled={busy||page>=Math.max(1,records.data.totalPages)} onClick={()=>setPage(value=>value+1)}>Next</Button></div></div>}
    </section>
    {detailId&&!modal&&<PayrollDetailsDialog key={detailId} detail={detail} own={own} user={user} busy={busy} uncertain={uncertain} error={writeError} onReload={reload} onClose={()=>setSelection({query:requestedId,id:null})} onEdit={record=>openModal('draft',record)} onSave={write} returnFocus={detailOpener}/>}
    {modal?.type==='salary'&&<SalaryRevisionDialog key={modal.employee.id} employee={modal.employee} history={salary.data} currentSalary={currentSalary} month={month} busy={busy} uncertain={uncertain} error={writeError} onSave={write} onReload={reload} onClose={()=>setModal(null)}/>}
    {modal?.type==='draft'&&<PayrollDraftDialog key={modal.record?.id||modal.employee.id} employee={modal.employee} record={modal.record} month={month} busy={busy} uncertain={uncertain} error={writeError} onSave={write} onReload={reload} onClose={()=>setModal(null)} returnFocus={modal.returnFocus}/>}
  </div>;
}
export default function PayrollPage({own=false}) {
  const {user}=useAuth();
  return <PayrollWorkspace key={`${user.id}:${user.role}:${own}`} own={own}/>;
}

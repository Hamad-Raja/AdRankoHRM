import {useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router';
import {UserRound, Plus, RefreshCw} from 'lucide-react';
import {useAuth} from '@/context/auth-context';
import {Button} from '@/components/ui/button';
import {ApiError} from '@/lib/api';
import {payrollRequest, payrollQuery} from '@/services/payroll.service';
import {usePayrollResource} from '@/components/payroll/use-payroll-resource';
import {PayrollField, PayrollStatus} from '@/components/payroll/payroll-fields';
import {currentMonth, inputClass, pkr, readable} from '@/components/payroll/payroll-format';
import SalaryRevisionDialog from '@/components/payroll/salary-revision-dialog';
import PayrollDraftDialog from '@/components/payroll/payroll-draft-dialog';
import EmployeeCombobox from '@/components/payroll/employee-combobox';
import EmployeeSalaryCard from '@/components/payroll/employee-salary-card';
import AnnualSummary from '@/components/payroll/annual-summary';
import PayslipCards from '@/components/payroll/payslip-cards';
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
  const [view,setView]=useState('monthly');
  const [annualRevision,setAnnualRevision]=useState(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;writeController.current?.abort();};},[]);
  const salary=usePayrollResource(!own&&selected?'/salaries/'+selected.id:null);
  const records=usePayrollResource((own?'/payslips':'')+'?'+payrollQuery({month,status,search,page,pageSize:20,employeeId:own?'':selected?.id||''}));
  const detail=usePayrollResource(detailId?(own?'/payslips/':'/')+detailId:null);
  const currentEmployee=salary.data?.employee||selected;
  const todayMonth=currentMonth();
  // History is ordered by effective month and revision by the existing API.
  // Match its effective-salary lookup without calculating any financial values.
  const currentSalary=salary.data?.versions.find(version=>version.effectiveMonth<=todayMonth)||null;
  const payrollMonth=month||todayMonth;
  const payrollSalary=monthPattern.test(payrollMonth)?salary.data?.versions.find(version=>version.effectiveMonth<=payrollMonth)||null:null;
  const canRevise=['ADMIN','HR'].includes(user.role);
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
      setAnnualRevision(value=>value+1);setUncertain(false);setModal(null);setNotice('Saved records reloaded. Check history before submitting another action.');return true;
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
      setAnnualRevision(value=>value+1);
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
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6"><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{own?'My Payslips':'Payroll Management'}</h1><p className="mt-2 text-sm text-muted-foreground">{own?'Review your finally approved and paid payslips.':'Manage employee salaries and prepare monthly payroll.'}</p></div><Button variant="outline" disabled={busy} onClick={()=>void reload()}><RefreshCw aria-hidden="true"/>Reload saved data</Button></header>
    {notice&&<p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">{notice}</p>}
    {writeError&&!modal&&<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{writeError.message}</p>}
    {uncertain&&!modal&&<p role="alert" className="text-sm text-muted-foreground">Reload saved data before another write. No automatic retry was sent.</p>}
    {!own&&<section aria-label="Employee selection" className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><UserRound aria-hidden="true" className="size-5"/></span><div><h2 className="text-lg font-semibold">Employee Selection</h2><p className="text-sm text-muted-foreground">Choose an employee to manage salary and monthly payroll.</p></div></div>
      <EmployeeCombobox selected={selected} onSelect={choose} disabled={busy||uncertain}/>
    </section>}
    {!own&&<EmployeeSalaryCard key={'salary-card:'+(selected?.id||'unselected')} employee={currentEmployee} resource={salary} currentSalary={currentSalary} payrollSalary={payrollSalary} month={monthPattern.test(month)?month:''} todayMonth={todayMonth} disabled={busy||uncertain} canRevise={canRevise} onRevise={()=>openModal('salary')}/>}
    <nav aria-label="Payroll views" className="flex flex-wrap gap-2"><Button variant={view==='monthly'?'default':'outline'} aria-pressed={view==='monthly'} disabled={busy} onClick={()=>setView('monthly')}>{own?'Monthly Payslips':'Monthly Payroll'}</Button><Button variant={view==='annual'?'default':'outline'} aria-pressed={view==='annual'} disabled={busy} onClick={()=>setView('annual')}>Annual Summary</Button></nav>
    {view==='annual'&&<AnnualSummary own={own} employee={selected} onView={openRecord} disabled={busy} revision={annualRevision}/>}
    <section hidden={view!=='monthly'} aria-label="Payroll records" className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{own?'Approved & Paid Payslips':'Monthly Payroll'}</h2><p className="mt-1 text-sm text-muted-foreground">{own?'Only your final payslips are available here.':selected?'Drafts, approvals and payment history for the selected employee.':'Review payroll records across employees, or select an employee to prepare a draft.'}</p></div>
        {!own&&user.role==='HR'&&<Button disabled={busy||uncertain||!payrollSalary} onClick={()=>openModal('draft')}><Plus aria-hidden="true"/>Prepare Payroll Draft</Button>}
      </div>
      {!own&&user.role==='HR'&&!payrollSalary&&<p className="text-xs text-muted-foreground">{!selected?'Select an employee to prepare a payroll draft.':salary.loading?'Checking salary for this payroll month...':salary.error?'Reload salary history before preparing payroll.':`A salary effective on or before ${payrollMonth} is required to prepare a draft.`}</p>}
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-3">
        <PayrollField label="Filter payroll month"><input className={`${inputClass} h-10`} type="month" value={month} onChange={event=>{setMonth(event.target.value);setPage(1);}}/></PayrollField>
        <PayrollField label="Filter status"><select className={`${inputClass} h-10`} value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">All statuses</option>{(own?['APPROVED','PAID']:['DRAFT','HR_APPROVED','APPROVED','PAID']).map(value=><option key={value} value={value}>{readable(value)}</option>)}</select></PayrollField>
        <PayrollField label="Payroll employee search"><input className={`${inputClass} h-10`} type="search" maxLength={120} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} placeholder="Employee name or code"/></PayrollField>
      </fieldset>
      <div aria-busy={records.loading} className="min-w-0 overflow-hidden rounded-2xl border border-border">
        {records.loading?<p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading payroll…</p>
          :records.error?<div role="alert" className="space-y-3 p-5"><p className="text-sm text-destructive">Payroll data unavailable. {records.error.message}</p><Button variant="outline" disabled={busy} onClick={()=>void records.reload().catch(()=>{})}>Retry payroll records</Button></div>
          :rows.length?own?<PayslipCards records={rows} onView={openRecord} disabled={busy}/>:<div role="region" aria-label="Monthly payroll table" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring">
            <table className={`w-full text-left text-sm ${own?'min-w-[48rem]':'min-w-[70rem]'}`}>
              <caption className="sr-only">{own?'Your finalized and paid payslips':'Monthly payroll financial snapshots and permitted actions'}</caption>
              <thead className="border-b border-border bg-muted/30"><tr>{(own?['Employee','Month','Payable Days','Worked Days','Status','Net Pay','Actions']:['Employee & ID','Payroll Month','Earned Basic','Additional Earnings','Total Deductions','Net Pay','Status','Actions']).map(label=><th key={label} scope="col" className="whitespace-nowrap px-4 py-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">{rows.map(record=><tr className="even:bg-muted/20 hover:bg-muted/40" key={record.id}>
                <th scope="row" className="min-w-44 px-4 py-5 text-left font-normal"><p className="font-semibold">{record.employeeName}</p><p className="mt-1 text-xs font-medium text-primary">{record.employeeCode}</p></th>
                <td className="whitespace-nowrap px-4 py-5 text-muted-foreground">{record.month}</td>
                {own?<><td className="px-4 py-5 tabular-nums">{record.totalPayableDays}</td><td className="px-4 py-5 tabular-nums">{record.workedDays}</td><td className="px-4 py-5"><PayrollStatus status={record.status}/></td></>:<>{[record.earnedBasic,record.additionalEarnings,record.totalDeductions].map((value,index)=><td key={index} className="whitespace-nowrap px-4 py-5 tabular-nums">{pkr(value)}</td>)}</>}
                <td className="whitespace-nowrap px-4 py-5 font-semibold tabular-nums">{pkr(record.netPay)}</td>
                {!own&&<td className="px-4 py-5"><PayrollStatus status={record.status} needsCorrection={record.needsCorrection}/></td>}
                <td className="px-4 py-5"><div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} aria-label={`View ${own?'payslip':'payroll'} ${record.month} for ${record.employeeName}`} onClick={()=>openRecord(record)}>View</Button>{!own&&user.role==='HR'&&record.status==='DRAFT'&&<Button variant="outline" size="sm" disabled={busy||uncertain} aria-label={`Edit draft ${record.month} for ${record.employeeName}`} onClick={()=>openModal('draft',record)}>Edit</Button>}</div></td>
              </tr>)}</tbody>
            </table>
          </div>:<p className="px-5 py-12 text-center text-sm text-muted-foreground">{own?'No final payslips found for these filters.':'No payroll records found for these filters.'}</p>}
        {!records.error&&records.data&&<footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 text-sm">
          <p className="text-muted-foreground">{rows.length?(records.data.page-1)*records.data.pageSize+1:0}–{rows.length?(records.data.page-1)*records.data.pageSize+rows.length:0} of {records.data.total} {own?'payslips':'payroll records'}</p>
          <div className="flex flex-wrap items-center gap-3"><span>Page {records.data.page} of {Math.max(1,records.data.totalPages)}</span><Button variant="outline" disabled={busy||records.loading||page<=1} onClick={()=>setPage(value=>value-1)}>Previous</Button><Button variant="outline" disabled={busy||records.loading||page>=Math.max(1,records.data.totalPages)} onClick={()=>setPage(value=>value+1)}>Next</Button></div>
        </footer>}
      </div>
    </section>
    {detailId&&!modal&&<PayrollDetailsDialog key={detailId} detail={detail} own={own} user={user} busy={busy} uncertain={uncertain} error={writeError} onReload={reload} onClose={()=>setSelection({query:requestedId,id:null})} onEdit={record=>openModal('draft',record)} onSave={write} returnFocus={detailOpener}/>}
    {modal?.type==='salary'&&<SalaryRevisionDialog key={'salary-dialog:'+modal.employee.id} employee={modal.employee} history={salary.data} currentSalary={currentSalary} month={month} busy={busy} uncertain={uncertain} error={writeError} onSave={write} onReload={reload} onClose={()=>setModal(null)}/>}
    {modal?.type==='draft'&&<PayrollDraftDialog key={modal.record?.id||modal.employee.id} employee={modal.employee} record={modal.record} month={month} busy={busy} uncertain={uncertain} error={writeError} onSave={write} onReload={reload} onClose={()=>setModal(null)} returnFocus={modal.returnFocus}/>}
  </div>;
}
export default function PayrollPage({own=false}) {
  const {user}=useAuth();
  return <PayrollWorkspace key={`${user.id}:${user.role}:${own}`} own={own}/>;
}

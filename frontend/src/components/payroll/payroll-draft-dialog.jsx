import {useEffect, useRef, useState} from 'react';
import {Plus, Trash2, Calculator, LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {payrollRequest} from '@/services/payroll.service';
import {useAuth} from '@/context/auth-context';
import PayrollDialog from './payroll-dialog';
import {PayrollField} from './payroll-fields';
import {currentMonth,inputClass,pkr,readable,earningTypes,deductionTypes} from './payroll-format';

function Adjustments({kind,items,onChange,disabled,error}) {
  const earnings=kind==='earnings', singular=earnings?'earning':'deduction', types=earnings?earningTypes:deductionTypes;
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border border-border p-4">
    <legend className="px-1 font-semibold">{earnings?'Earnings':'Deductions'} <span className="text-sm font-normal text-muted-foreground">(Optional)</span></legend>
    {error&&<p className="text-sm text-destructive">{error}</p>}
    {!items.length&&<p className="text-sm text-muted-foreground">No {kind} added.</p>}
    {items.map((item,index)=><div key={item.key} className="grid min-w-0 gap-3 rounded-lg bg-background/40 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1fr_auto]">
      <PayrollField label={`${earnings?'Payment':'Deduction'} Type ${index+1}`}><select className={inputClass} required value={item.type} onChange={event=>onChange(items.map(row=>row.key===item.key?{...row,type:event.target.value}:row))}><option value="">Select type</option>{types.map(type=><option key={type} value={type}>{readable(type)}</option>)}</select></PayrollField>
      <PayrollField label={`${earnings?'Payment':'Deduction'} Description ${index+1} (Optional)`}><input className={inputClass} maxLength={120} value={item.label} placeholder={item.type?readable(item.type):'Description'} onChange={event=>onChange(items.map(row=>row.key===item.key?{...row,label:event.target.value}:row))}/></PayrollField>
      <PayrollField label={`${earnings?'Earning':'Deduction'} Amount ${index+1} (PKR)`}><input className={inputClass} inputMode="decimal" required value={item.amount} onChange={event=>onChange(items.map(row=>row.key===item.key?{...row,amount:event.target.value}:row))}/></PayrollField>
      <Button type="button" variant="outline" className="self-end" aria-label={`Remove ${singular} ${index+1}`} onClick={()=>onChange(items.filter(row=>row.key!==item.key))}><Trash2 aria-hidden="true"/><span className="lg:sr-only">Remove</span></Button>
    </div>)}
    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={disabled||items.length>=50} onClick={()=>onChange([...items,{key:crypto.randomUUID(),type:'',label:'',amount:''}])}><Plus aria-hidden="true"/>Add {earnings?'Earning':'Deduction'}</Button><p className="text-xs text-muted-foreground">Blank descriptions use the selected type.</p></div>
  </fieldset>;
}
export default function PayrollDraftDialog({employee,record,month,busy,uncertain,error,onSave,onReload,onClose,returnFocus}) {
  const {getCsrfToken}=useAuth(), form=useRef(null), pendingPreview=useRef(null);
  const [initial]=useState(()=>({month:record?.month||month||currentMonth(),totalPayableDays:record?.totalPayableDays||'',workedDays:record?.workedDays||'',earnings:record?.earnings.map(({type,label,amount})=>({type,label,amount}))||[],deductions:record?.deductions.map(({type,label,amount})=>({type,label,amount}))||[]}));
  const [values,setValues]=useState(initial), [reason,setReason]=useState('');
  const [earnings,setEarnings]=useState(()=>initial.earnings.map(item=>({...item,key:crypto.randomUUID()})));
  const [deductions,setDeductions]=useState(()=>initial.deductions.map(item=>({...item,key:crypto.randomUUID()})));
  const [preview,setPreview]=useState(null), [previewBusy,setPreviewBusy]=useState(false), [previewError,setPreviewError]=useState(null);
  useEffect(()=>()=>pendingPreview.current?.abort(),[]);
  const input={employeeId:employee.id,month:values.month,totalPayableDays:values.totalPayableDays,workedDays:values.workedDays,
    earnings:earnings.map(({type,label,amount})=>({type,label,amount})),deductions:deductions.map(({type,label,amount})=>({type,label,amount}))};
  const signature=JSON.stringify(input);
  const initialSignature=JSON.stringify({employeeId:employee.id,...initial});
  const dirty=Boolean(reason)||signature!==initialSignature;
  const visiblePreview=preview?.signature===signature?preview.data:null;
  const failure=error||previewError;
  const fieldError=name=>failure?.details?.field===name?failure.message:undefined;
  function change(event){setValues(old=>({...old,[event.target.name]:event.target.value}));setPreviewError(null);}
  async function calculate() {
    if(pendingPreview.current)return;
    for(const field of form.current.elements){if(field.name==='reason'||!field.reportValidity)continue;if(!field.reportValidity())return;}
    const controller=new AbortController();pendingPreview.current=controller;setPreviewBusy(true);setPreviewError(null);
    try{const result=await payrollRequest('/preview',{method:'POST',body:input,csrfToken:getCsrfToken(),signal:controller.signal});if(!controller.signal.aborted)setPreview({signature,data:result});}
    catch(error){if(!controller.signal.aborted)setPreviewError(error);}
    finally{if(pendingPreview.current===controller)pendingPreview.current=null;if(!controller.signal.aborted)setPreviewBusy(false);}
  }
  async function save(event){event.preventDefault();const body=record?{totalPayableDays:input.totalPayableDays,workedDays:input.workedDays,earnings:input.earnings,deductions:input.deductions,reason,expectedVersion:record.version}:{...input,reason};const saved=await onSave(record?'/'+record.id:'',body,record?'PATCH':'POST');if(saved)onClose();}
  return <PayrollDialog title={record?'Edit Payroll Draft':'Prepare Payroll Draft'} description="Enter approved payable and worked days, then calculate and review this period's pay." wide busy={busy} dirty={dirty} error={failure} uncertain={uncertain} onReload={onReload} onClose={onClose} returnFocus={returnFocus}>
    {close=><form ref={form} onSubmit={save} aria-label="Payroll draft" className="flex min-h-0 flex-col overflow-hidden" aria-busy={busy}>
      <div className="payroll-form-body min-h-0 overflow-y-auto overscroll-contain px-1 pb-5"><fieldset disabled={busy||uncertain} className="min-w-0 space-y-5">
        <PayrollField label="Employee"><input className={inputClass} readOnly value={`${employee.fullName} · ${employee.employeeCode}`}/></PayrollField>
        <section aria-label="Payroll information" className="space-y-3"><h3 className="font-semibold">Payroll Information</h3><div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <PayrollField label="Payroll Month" error={fieldError('month')}><input className={inputClass} type="month" name="month" required disabled={Boolean(record)} value={values.month} onChange={change}/></PayrollField>
          <PayrollField label="Total Payable Days" error={fieldError('totalPayableDays')}><input className={inputClass} name="totalPayableDays" inputMode="decimal" required value={values.totalPayableDays} onChange={change}/></PayrollField>
          <PayrollField label="Worked Days" error={fieldError('workedDays')}><input className={inputClass} name="workedDays" inputMode="decimal" required value={values.workedDays} onChange={change}/></PayrollField>
        </div><p className="text-xs text-muted-foreground">Enter up to 31 payable days with at most two decimal places. Attendance does not replace your entered days.</p></section>
        <Adjustments kind="earnings" items={earnings} onChange={setEarnings} error={failure?.details?.field?.startsWith('earnings')?failure.message:null}/>
        <Adjustments kind="deductions" items={deductions} onChange={setDeductions} error={failure?.details?.field?.startsWith('deductions')?failure.message:null}/>
        <section aria-label="Payroll calculation preview" className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"><h3 className="font-semibold">Payroll Calculation Preview</h3>{visiblePreview?<><p className="text-xs text-muted-foreground">{visiblePreview.month} · Monthly basic {pkr(visiblePreview.monthlyBasic)}</p><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Prorated Basic Salary',visiblePreview.earnedBasic],['Total Additional Earnings',visiblePreview.additionalEarnings],['Total Deductions',visiblePreview.totalDeductions],['Net Payable Salary',visiblePreview.netPay]].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{pkr(value)}</dd></div>)}</dl></>:<p className="text-sm text-muted-foreground">Calculate a preview after entering the payroll details. Changed inputs require a new preview.</p>}</section>
        <PayrollField label="Draft Change Reason" hint="Required for the payroll audit history."><input className={inputClass} name="reason" required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></PayrollField>
      </fieldset></div>
      <footer className="relative flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card pt-4"><Button type="button" variant="outline" disabled={busy||uncertain||previewBusy} onClick={()=>void calculate()}>{previewBusy?<LoaderCircle className="animate-spin" aria-hidden="true"/>:<Calculator aria-hidden="true"/>}{previewBusy?'Calculating…':'Calculate Preview'}</Button><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy||uncertain||previewBusy}>{busy?'Saving…':record?'Save Draft Changes':'Save Draft'}</Button></div></footer>
    </form>}
  </PayrollDialog>;
}

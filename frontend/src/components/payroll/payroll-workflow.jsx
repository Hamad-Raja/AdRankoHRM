import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {PayrollField} from './payroll-fields';
import {dateTime,inputClass,pkr,readable} from './payroll-format';

export default function PayrollWorkflow({record,user,busy,uncertain,onEdit,onSave}) {
  const [reason,setReason]=useState(''),[method,setMethod]=useState('CASH'),[paidOn,setPaidOn]=useState(''),[reference,setReference]=useState(''),[note,setNote]=useState('');
  async function action(name){const body={expectedVersion:record.version,reason};if(name==='pay')Object.assign(body,{method,paidOn,...(reference?{reference}:{}),...(note?{note}:{})});await onSave('/'+record.id+'/'+name,body);}
  return <>
    {record.status!=='PAID'&&<section aria-label="Payroll actions" className="space-y-4 rounded-2xl border border-border bg-card p-5"><h3 className="text-lg font-semibold">Workflow actions</h3><p className="text-sm text-muted-foreground">Draft → HR approval → Admin approval → Paid. Final approval requires a separate Admin account and locks the financial snapshot.</p>
      <fieldset disabled={busy||uncertain} className="space-y-4">
        <PayrollField label="Workflow reason"><input className={inputClass} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></PayrollField>
        <div className="flex flex-wrap gap-3">
          {record.status==='DRAFT'&&<Button type="button" variant="outline" onClick={()=>onEdit(record)}>Edit / Recalculate Draft</Button>}
          {record.status==='DRAFT'&&user.role==='HR'&&<Button disabled={!reason.trim()} onClick={()=>void action('hr-approve')}>HR Approve</Button>}
          {record.status==='HR_APPROVED'&&<Button variant="outline" disabled={!reason.trim()} onClick={()=>void action('return')}>Return to Draft</Button>}
          {record.status==='HR_APPROVED'&&user.role==='ADMIN'&&<Button disabled={!reason.trim()} onClick={()=>void action('approve')}>Admin Final Approve</Button>}
        </div>
        {record.status==='APPROVED'&&<div className="grid min-w-0 gap-4 sm:grid-cols-2"><p className="text-sm text-muted-foreground sm:col-span-2">Record the full approved amount {pkr(record.netPay)}. This does not initiate a transfer.</p><PayrollField label="Payment method"><select className={inputClass} value={method} onChange={event=>setMethod(event.target.value)}>{['CASH','BANK_TRANSFER','OTHER'].map(value=><option key={value} value={value}>{readable(value)}</option>)}</select></PayrollField><PayrollField label="Payment date"><input className={inputClass} type="date" value={paidOn} onChange={event=>setPaidOn(event.target.value)}/></PayrollField><PayrollField label="Payment reference"><input className={inputClass} maxLength={120} value={reference} onChange={event=>setReference(event.target.value)}/></PayrollField><PayrollField label="Payment note (Optional)"><input className={inputClass} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></PayrollField><Button disabled={!reason.trim()||!paidOn||(method!=='CASH'&&!reference.trim())} onClick={()=>void action('pay')}>Record Full Payment</Button></div>}
      </fieldset>
    </section>}
    <details className="space-y-3 rounded-2xl border border-border bg-card p-5" aria-label="Payroll history"><summary className="cursor-pointer rounded font-semibold focus-visible:outline-2 focus-visible:outline-ring">Approval & Payment History</summary><ul className="space-y-3 pt-3 text-sm">{record.history?.map((entry,index)=><li key={index} className="space-y-1 border-t border-border pt-3"><p className="font-medium">{readable(entry.action)} · {entry.actor}</p><p className="text-xs text-muted-foreground">{dateTime(entry.at)}</p>{entry.metadata?.reason&&<p className="break-words">{entry.metadata.reason}</p>}</li>)}</ul></details>
  </>;
}

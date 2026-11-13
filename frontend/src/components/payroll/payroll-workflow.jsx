import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {PayrollField} from './payroll-fields';
import PayrollDialog from './payroll-dialog';
import {dateTime,inputClass,pkr,readable} from './payroll-format';

const historyLabels={PAYROLL_CREATED:'Draft prepared',PAYROLL_EDIT:'Draft corrected',PAYROLL_RETURN:'Sent back for correction',PAYROLL_HR_APPROVE:'HR approved',PAYROLL_APPROVE:'Final approval',PAYROLL_PAY:'Payment recorded'};

export default function PayrollWorkflow({record,user,busy,uncertain,error,onReload,onEdit,onSave}) {
  const [decision,setDecision]=useState(null),[reason,setReason]=useState('');
  const [method,setMethod]=useState('CASH'),[paidOn,setPaidOn]=useState(''),[reference,setReference]=useState(''),[note,setNote]=useState('');
  const hr=user.role==='HR',admin=user.role==='ADMIN';
  const editable=hr&&record.status==='DRAFT',reviewable=admin&&record.status==='HR_APPROVED';
  const payable=admin&&record.status==='APPROVED';
  const returning=decision==='return',finalizing=decision==='approve';
  function open(action){setReason('');setDecision(action);}
  async function action(name){
    const body={expectedVersion:record.version,reason};
    if(name==='pay')Object.assign(body,{method,paidOn,...(reference?{reference}:{}),...(note?{note}:{})});
    const saved=await onSave('/'+record.id+'/'+name,body);if(saved)setDecision(null);
  }
  return <>
    {record.needsCorrection&&<div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"><p className="font-semibold">Needs Correction</p><p className="mt-2 whitespace-pre-wrap break-words">{record.correctionReason||'Review the approval history for correction details.'}</p></div>}
    {(editable||reviewable||payable)&&<section aria-label="Payroll actions" className="space-y-4 rounded-2xl border border-border bg-card p-5"><h3 className="text-lg font-semibold">Approval Actions</h3>
      <fieldset disabled={busy||uncertain} className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {editable&&<><Button type="button" variant="outline" onClick={()=>onEdit(record)}>Edit Draft</Button><Button type="button" onClick={()=>open('hr-approve')}>{record.needsCorrection?'Resubmit':'HR Approve'}</Button></>}
          {reviewable&&<><Button type="button" variant="outline" onClick={()=>open('return')}>Send Back</Button><Button type="button" disabled={record.hrApprovedByUserId===user.id} onClick={()=>open('approve')}>Final Approve</Button>{record.hrApprovedByUserId===user.id&&<p className="text-sm text-muted-foreground">A different Admin must give final approval.</p>}</>}
        </div>
        {payable&&<div className="space-y-3"><p className="text-sm text-muted-foreground">Record the full approved amount {pkr(record.netPay)} after an external payment. OfficeHR does not transfer funds.</p><Button type="button" onClick={()=>open('pay')}>Record Payment</Button></div>}
      </fieldset>
    </section>}
    {!editable&&!reviewable&&!payable&&record.status==='HR_APPROVED'&&<p className="text-sm text-muted-foreground">Awaiting Admin review.</p>}
    <details className="space-y-3 rounded-2xl border border-border bg-card p-5" aria-label="Payroll history"><summary className="cursor-pointer rounded font-semibold focus-visible:outline-2 focus-visible:outline-ring">Approval History</summary><ul className="space-y-3 pt-3 text-sm">{record.history?.map((entry,index)=><li key={index} className="space-y-1 border-t border-border pt-3"><p className="font-medium">{entry.action==='PAYROLL_HR_APPROVE'&&entry.metadata?.resubmitted?'HR resubmitted':historyLabels[entry.action]||'Payroll updated'} · {entry.actor}</p><p className="text-xs text-muted-foreground">{dateTime(entry.at)}</p>{entry.metadata?.reason&&<p className="break-words">{entry.metadata.reason}</p>}</li>)}</ul></details>
    {decision&&<PayrollDialog title={decision==='pay'?'Record Full Payment':returning?'Send Back for Correction':finalizing?'Confirm Final Approval':record.needsCorrection?'Resubmit Payroll':'Confirm HR Approval'} description={decision==='pay'?'Record one full external payment for this finalized payroll. This does not initiate a transfer.':returning?'Payroll will return to HR for correction. Its approval history will be retained.':finalizing?'Final approval locks the payroll financial snapshot. Review the payslip before confirming.':'Confirm that this payroll is ready for Admin review.'} confirmDiscard busy={busy} dirty={Boolean(reason)||(decision==='pay'&&Boolean(paidOn||reference||note||method!=='CASH'))} error={error} uncertain={uncertain} onReload={onReload} onClose={()=>setDecision(null)}>
      {close=><form className="flex min-h-0 flex-col overflow-hidden" onSubmit={event=>{event.preventDefault();void action(decision);}}>
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-1 pb-5"><p className="text-sm font-medium">{record.employeeName} · {record.employeeCode} · {record.month}</p><p className="text-sm">Net payable: <strong>{pkr(record.netPay)}</strong></p>{decision==='pay'?<fieldset disabled={busy||uncertain} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <PayrollField label="Payment method"><select className={inputClass} value={method} onChange={event=>setMethod(event.target.value)}>{['CASH','BANK_TRANSFER','OTHER'].map(value=><option key={value} value={value}>{readable(value)}</option>)}</select></PayrollField>
          <PayrollField label="Payment date"><input className={inputClass} required type="date" value={paidOn} onChange={event=>setPaidOn(event.target.value)}/></PayrollField>
          <PayrollField label="Payment reference"><input className={inputClass} required={method!=='CASH'} maxLength={120} value={reference} onChange={event=>setReference(event.target.value)}/></PayrollField>
          <PayrollField label="Payment note (Optional)"><input className={inputClass} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></PayrollField>
          <PayrollField label="Payment audit reason"><input className={inputClass} required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></PayrollField>
        </fieldset>:<PayrollField label={returning?'Reason for Sending Back':'Approval note'} hint={returning?undefined:'Required for approval history.'}>{returning?<textarea className={`${inputClass} h-auto min-h-28 py-3`} required maxLength={1000} value={reason} placeholder="Explain what HR needs to correct..." onChange={event=>setReason(event.target.value)}/>:<input className={inputClass} required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>}</PayrollField>}</div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border bg-card pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy||uncertain||!reason.trim()}>{busy?'Saving…':decision==='pay'?'Record Full Payment':returning?'Confirm Send Back':finalizing?'Confirm Final Approval':record.needsCorrection?'Confirm Resubmission':'Confirm HR Approval'}</Button></footer>
      </form>}
    </PayrollDialog>}
  </>;
}

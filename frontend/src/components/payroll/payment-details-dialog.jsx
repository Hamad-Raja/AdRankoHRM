import {Button} from '@/components/ui/button';
import {InitialsAvatar} from '@/components/employees/directory-parts';
import PayrollDialog from './payroll-dialog';
import PaymentDetails from './payment-details';
import {preparationMonth} from './payroll-format';

export default function PaymentDetailsDialog({detail,onClose,returnFocus}) {
  const record=detail.loading||detail.error?null:detail.data;
  return <PayrollDialog title="Payment details" description={record?preparationMonth(record.month):'Recorded external payroll payment'} onClose={onClose} returnFocus={returnFocus}>
    {close=><>
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-1 pb-5">
        {detail.loading?<p role="status">Loading payment details...</p>:detail.error?<div role="alert" className="space-y-3 text-sm"><p className="text-destructive">{detail.error.message}</p><Button variant="outline" onClick={()=>void detail.reload().catch(()=>{})}>Retry payment details</Button></div>:record?.payment?<>
          <header className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/40 p-4"><InitialsAvatar name={record.employeeName||'?'}/><div className="min-w-0"><h3 className="break-words font-semibold">{record.employeeName||'Not recorded'}</h3><p className="break-words text-sm text-muted-foreground">{record.employeeCode||'Not recorded'}</p></div></header>
          <PaymentDetails record={record}/>
        </>:<p role="status" className="text-sm text-muted-foreground">No recorded payment is available for this payroll.</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-border pt-4"><p className="max-w-sm text-xs text-muted-foreground">Records an external payment. AdRankoHRM does not transfer funds.</p><Button variant="outline" onClick={close}>Close</Button></footer>
    </>}
  </PayrollDialog>;
}

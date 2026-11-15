import {Printer} from 'lucide-react';
import {Button} from '@/components/ui/button';
import PayrollDialog from './payroll-dialog';
import Payslip from './payslip';
import PayrollWorkflow from './payroll-workflow';
import {PayrollStatus} from './payroll-fields';

export default function PayrollDetailsDialog({detail,own,user,busy,uncertain,error,onReload,onClose,onEdit,onSave,returnFocus,initialAction=null,refreshKey=0}) {
  const record=detail.data,version=record?record.id+':'+record.version:null;
  return <PayrollDialog title={own?'Payslip Details':'Payroll Details'} titleAccessory={record&&<PayrollStatus status={record.status} needsCorrection={record.needsCorrection}/>} description="Review the payslip and available approval actions." confirmDiscard wide busy={busy} uncertain={uncertain} error={error} onReload={onReload} onClose={onClose} returnFocus={returnFocus}>
    {close=><>
      <section aria-label="Payroll detail" className="payroll-details-body min-h-0 space-y-4 overflow-y-auto overscroll-contain px-1 pb-5">
        {detail.loading?<p role="status">Loading saved payroll details…</p>:detail.error?<p role="alert" className="text-sm text-destructive">{detail.error.message}</p>:record&&<>
          <Payslip record={record} own={own}/>
          {!own&&<PayrollWorkflow key={version} initialAction={initialAction} refreshKey={refreshKey} record={record} user={user} busy={busy} uncertain={uncertain} error={error} onReload={onReload} onEdit={onEdit} onSave={onSave}/>}
        </>}
      </section>
      <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border pt-4">
        {record&&['APPROVED','PAID'].includes(record.status)&&<Button variant="outline" onClick={()=>window.print()}><Printer aria-hidden="true"/>Print / Save as PDF</Button>}
        <Button variant="outline" disabled={busy} onClick={close}>Close details</Button>
      </footer>
    </>}
  </PayrollDialog>;
}

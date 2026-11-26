import {CheckCircle2} from 'lucide-react';
import {calendarDate,dateTime,pkr,readable} from './payroll-format';

export default function PaymentDetails({record,own=false}) {
  const payment=record.payment;
  if(!payment)return null;
  // This history is already scoped and authorized by the payroll detail endpoint.
  const confirmation=!own?record.history?.findLast(entry=>entry.action==='PAYROLL_PAY'):null;
  const missing='Not recorded';
  return <section aria-label="Recorded payment" className="min-w-0 space-y-5 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 p-5">
      <div><p className="text-muted-foreground">Recorded payment amount</p><p className="mt-2 break-words text-2xl font-semibold tabular-nums text-primary">{payment.amount!=null?pkr(payment.amount):missing}</p></div>
      <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><CheckCircle2 className="size-4" aria-hidden="true"/>Payment recorded</span>
    </div>
    <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Payment method</dt><dd className="mt-1 font-medium">{payment.method?readable(payment.method):missing}</dd></div>
      <div><dt className="text-muted-foreground">Payment date</dt><dd className="mt-1 font-medium">{payment.paidOn?calendarDate(payment.paidOn):missing}</dd></div>
      {!own&&<div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Payment reference</dt><dd className="mt-1 select-text whitespace-pre-wrap [overflow-wrap:anywhere]">{payment.reference||missing}</dd></div>}
      {!own&&payment.note&&<div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Payment note</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{payment.note}</dd></div>}
      {confirmation?.metadata?.reason&&<div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Payment confirmation note</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{confirmation.metadata.reason}</dd></div>}
      {confirmation?.actor&&<div className="min-w-0"><dt className="text-muted-foreground">Recorded by</dt><dd className="mt-1 [overflow-wrap:anywhere]">{confirmation.actor}</dd></div>}
      {payment.recordedAt&&<div><dt className="text-muted-foreground">Recorded at (Asia/Karachi)</dt><dd className="mt-1">{dateTime(payment.recordedAt)}</dd></div>}
    </dl>
  </section>;
}

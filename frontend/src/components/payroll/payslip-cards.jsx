import {Button} from '@/components/ui/button';
import {PayrollStatus} from './payroll-fields';
import {pkr} from './payroll-format';

export default function PayslipCards({records,onView,disabled}){
  return <div aria-label="Monthly payslips" className="grid min-w-0 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">{records.map(record=><article key={record.id} aria-label={`Payslip ${record.month}`} className="min-w-0 space-y-4 rounded-xl border border-border bg-background/40 p-5"><header className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{record.month}</h3><PayrollStatus status={record.status}/></header><dl className="space-y-3 text-sm">{[['Gross Earnings',record.grossPay],['Deductions',record.totalDeductions],['Net Pay',record.netPay]].map(([label,value])=><div key={label} className={`flex flex-wrap justify-between gap-2 ${label==='Net Pay'?'border-t border-border pt-3 font-semibold text-primary':''}`}><dt>{label}</dt><dd className="break-words tabular-nums">{pkr(value)}</dd></div>)}</dl><Button className="w-full" variant="outline" disabled={disabled} aria-label={`View payslip ${record.month} for ${record.employeeName}`} onClick={()=>onView(record)}>View Payslip</Button></article>)}</div>;
}

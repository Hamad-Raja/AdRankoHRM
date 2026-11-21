import {History, UserRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {pkr} from './payroll-format';

export default function EmployeeSalaryCard({employee,resource,currentSalary,payrollSalary,month,todayMonth,disabled,canRevise,onRevise}) {
  const versions=resource.data?.versions||[];
  const hasHistory=versions.length>0;
  const boundary=resource.data?.rehireBoundaries?.find(b=>b.month<=todayMonth);
  const unconfigured=boundary&&!currentSalary&&!versions.some(v=>v.effectiveMonth>=boundary.month&&!boundary.excludedVersionIds.includes(v.id));
  return <section aria-label="Employee salary" aria-busy={resource.loading} className="min-w-0 rounded-2xl border border-border bg-card text-card-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:px-6">
      <div className="min-w-0"><h2 className="text-lg font-semibold">Employee Salary</h2><p className="mt-1 break-words text-sm text-muted-foreground">{employee?<>{employee.fullName} <span className="whitespace-nowrap">· {employee.employeeCode}</span></>:'Select an employee to review their salary.'}</p>{resource.data?.employee.organization&&<p className="mt-1 break-words text-xs text-muted-foreground">{[resource.data.employee.organization.department,resource.data.employee.organization.designation].filter(Boolean).join(' · ')}</p>}</div>
      {employee&&canRevise&&<Button variant="outline" disabled={disabled||!resource.data} onClick={onRevise}><History aria-hidden="true"/>{resource.data&&(!hasHistory||unconfigured)?'Set Up Salary':'Revise Pay'}</Button>}
    </div>
    {!employee?<div className="flex flex-col items-center gap-3 px-5 py-10 text-center"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound aria-hidden="true" className="size-5"/></span><p className="text-sm text-muted-foreground">Choose an employee above to view monthly basic pay, effective month and salary history.</p></div>
      :resource.loading?<p role="status" className="p-6 text-sm text-muted-foreground">Loading salary history…</p>
      :resource.error?<div role="alert" className="space-y-3 p-6"><p className="text-sm text-destructive">Salary history unavailable: {resource.error.message}</p><Button variant="outline" disabled={disabled} onClick={()=>void resource.reload().catch(()=>{})}>Retry salary history</Button></div>
      :resource.data&&<div className="space-y-5 p-5 sm:p-6">
        {!hasHistory||unconfigured?<div className="rounded-xl border border-dashed border-border bg-background/40 p-5"><p className="font-medium">Salary not configured</p><p className="mt-1 text-sm text-muted-foreground">{canRevise?'Use Set Up Salary to save an effective monthly basic salary before preparing payroll.':'An authorized HR or Admin must configure an effective salary before payroll can be prepared.'}</p></div>
          :<>
            <dl className="grid min-w-0 gap-5 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-2">
              <div><dt className="text-sm text-muted-foreground">Current Monthly Basic Salary</dt><dd className="mt-2 break-words text-2xl font-semibold tabular-nums text-primary sm:text-3xl">{currentSalary?pkr(currentSalary.monthlyBasic):'No salary effective yet'}</dd><p className="mt-1 text-xs text-muted-foreground">Current month: {todayMonth}</p></div>
              <div><dt className="text-sm text-muted-foreground">Effective Month</dt><dd className="mt-2 font-semibold">{currentSalary?.effectiveMonth||'Not effective yet'}</dd>{versions[0]?.effectiveMonth>todayMonth&&<p className="mt-2 text-xs text-muted-foreground">Future changes are saved in Salary History and take effect in their specified month.</p>}</div>
            </dl>
            {month&&month!==todayMonth&&<div className="rounded-xl border border-primary/25 bg-primary/5 p-4"><p className="text-sm font-medium">Salary applicable to payroll month {month}</p><p className="mt-2 break-words text-xl font-semibold tabular-nums">{payrollSalary?pkr(payrollSalary.monthlyBasic):'No salary effective for this month'}</p><p className="mt-1 text-xs text-muted-foreground">{payrollSalary?`Effective from ${payrollSalary.effectiveMonth}.`:'Save a salary effective on or before this month before preparing payroll.'} Existing payroll records retain their saved financial snapshots.</p></div>}
          </>}
        <details key={employee.id} className="group min-w-0 rounded-xl border border-border">
          <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Salary History <span className="ml-1 text-muted-foreground">({versions.length})</span></summary>
          {hasHistory?<div role="region" aria-label="Salary history records" tabIndex={0} className="overflow-x-auto border-t border-border focus-visible:outline-2 focus-visible:outline-ring"><table className="w-full min-w-[36rem] text-left text-sm"><caption className="sr-only">Salary revisions, effective months and reasons</caption><thead className="border-b border-border bg-muted/30 text-muted-foreground font-semibold"><tr>{['Effective Month','Monthly Basic','Change','Reason'].map(label=><th key={label} scope="col" className="whitespace-nowrap px-4 py-3 text-sm font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{versions.map(version=><tr key={version.id} className="even:bg-muted/20"><td className="px-4 py-3"><p>{version.effectiveMonth}</p><p className="text-xs text-muted-foreground">Change {version.revision}</p></td><td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">{pkr(version.monthlyBasic)}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{version.changeAmount?pkr(version.changeAmount):'—'}</td><td className="min-w-36 break-words px-4 py-3 text-muted-foreground">{version.reason}</td></tr>)}</tbody></table></div>:<p className="border-t border-border p-4 text-sm text-muted-foreground">No salary history yet.</p>}
        </details>
      </div>}
  </section>;
}

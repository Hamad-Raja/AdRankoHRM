import {useState} from 'react';
import {Button} from '@/components/ui/button';
import PayrollDialog from './payroll-dialog';
import {PayrollField} from './payroll-fields';
import {currentMonth, inputClass, pkr} from './payroll-format';

export default function SalaryRevisionDialog({employee,history,currentSalary,month,busy,uncertain,error,onSave,onReload,onClose}) {
  const [initialMonth]=useState(()=>month||currentMonth());
  const [versions]=useState(()=>history?.versions||[]);
  const [effectiveMonth,setMonth]=useState(initialMonth);
  const [amount,setAmount]=useState(''), [reason,setReason]=useState('');
  const dirty=effectiveMonth!==initialMonth||Boolean(amount||reason);
  async function save(event) {
    event.preventDefault();
    const previous=versions.find(version=>version.effectiveMonth===effectiveMonth);
    const saved=await onSave('/salaries/'+employee.id,{effectiveMonth,monthlyBasic:amount,expectedPreviousId:previous?.id||null,reason});
    if(saved)onClose();
  }
  return <PayrollDialog title="Revise Pay" description="Save an effective-dated salary revision while preserving previous records." busy={busy} dirty={dirty} error={error} uncertain={uncertain} onReload={onReload} onClose={onClose}>
    {close=><form onSubmit={save} aria-label="Salary revision" className="space-y-5" aria-busy={busy}>
      <fieldset disabled={busy||uncertain} className="min-w-0 space-y-4">
        <PayrollField label="Employee"><input className={inputClass} readOnly value={`${employee.fullName} · ${employee.employeeCode}`}/></PayrollField>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <PayrollField label="Effective Month"><input className={inputClass} type="month" required value={effectiveMonth} onChange={event=>setMonth(event.target.value)}/></PayrollField>
          <PayrollField label="Current Monthly Basic Salary"><input className={inputClass} readOnly value={currentSalary?pkr(currentSalary.monthlyBasic):'Not set'}/></PayrollField>
        </div>
        <PayrollField label="New Monthly Basic Salary (PKR)" hint="Enter a positive amount without commas, with at most two decimal places."><input className={inputClass} required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="44000.00"/></PayrollField>
        <PayrollField label="Reason for Salary Change" hint="Required for the existing salary audit history."><textarea className={`${inputClass} h-auto min-h-24 py-3`} required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></PayrollField>
      </fieldset>
      <footer className="flex flex-wrap justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy||uncertain}>{busy?'Saving…':'Save Revision'}</Button></footer>
    </form>}
  </PayrollDialog>;
}

import {FieldInput,FieldTextarea} from '@/components/ui/field-input';
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
  return <PayrollDialog title="Revise Pay" description="Save a salary change from the selected month while preserving previous salaries." confirmDiscard busy={busy} dirty={dirty} error={error} uncertain={uncertain} onReload={onReload} onClose={onClose}>
    {close=><form onSubmit={save} aria-label="Salary Change" className="flex min-h-0 flex-col overflow-hidden" aria-busy={busy}>
      <div className="payroll-form-body min-h-0 overflow-y-auto overscroll-contain px-1 pb-5"><fieldset disabled={busy||uncertain} className="min-w-0 space-y-4">
        <PayrollField label="Employee"><FieldInput className={inputClass} readOnly value={`${employee.fullName} · ${employee.employeeCode}`}/></PayrollField>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <PayrollField label="Effective Month"><FieldInput className={inputClass} type="month" required value={effectiveMonth} onChange={event=>setMonth(event.target.value)}/></PayrollField>
          <PayrollField label="Current Monthly Basic Salary"><FieldInput className={inputClass} readOnly value={currentSalary?pkr(currentSalary.monthlyBasic):'Not set'}/></PayrollField>
        </div>
        <PayrollField label="New Monthly Basic Salary (PKR)" hint="Enter a positive amount without commas, with at most two decimal places."><FieldInput className={inputClass} required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="44000.00"/></PayrollField>
        <PayrollField label="Reason for Salary Change" hint="Required for the existing salary audit history."><FieldTextarea className={`${inputClass} h-auto min-h-24 py-3`} required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></PayrollField>
      </fieldset></div>
      <footer className="relative flex shrink-0 flex-wrap justify-end gap-3 border-t border-border bg-card pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy||uncertain}>{busy?'Saving…':'Save Change'}</Button></footer>
    </form>}
  </PayrollDialog>;
}

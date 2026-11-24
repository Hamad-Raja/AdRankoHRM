import {cloneElement, useId, useState} from 'react';
import {pkr,readable} from './payroll-format';

export function PayrollFinancialComparison({before,after}) {
  if(!before||!after)return null;
  return <details className="mt-2 text-xs font-normal"><summary className="cursor-pointer font-medium">Financial breakdown</summary><dl className="mt-2 space-y-2">{[['Earned basic','earnedBasic'],['Additional earnings','additionalEarnings'],['Gross pay','grossPay'],['Deductions','totalDeductions']].map(([label,key])=><div key={key}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{pkr(before[key])} → {pkr(after[key])}</dd></div>)}</dl></details>;
}

export function PayrollField({label, children, hint, error}) {
  const id = useId();
  const [invalid, setInvalid] = useState({value:children.props.value,message:''});
  // Generated passwords and email shortcuts change controlled values without
  // firing an input event. A native error belongs only to the value validated.
  const message = error || (invalid.value===children.props.value?invalid.message:'');
  const described = [hint && id+'-hint', message && id+'-error'].filter(Boolean).join(' ') || undefined;
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="block text-sm font-medium">{label}{children.props.required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}</label>
    {cloneElement(children, {id, 'aria-label':label, 'aria-describedby':described, 'aria-invalid':Boolean(message),
      onInvalid:event=>{setInvalid({value:children.props.value,message:event.target.validationMessage});children.props.onInvalid?.(event);},
      onChange:event=>{setInvalid({value:event.target.value,message:''});children.props.onChange?.(event);}})}
    {hint && <p id={id+'-hint'} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    {message && <p id={id+'-error'} className="text-sm text-destructive">{message}</p>}
  </div>;
}
export function PayrollStatus({status,needsCorrection=false}) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${status==='PAID'||status==='APPROVED'?'bg-primary/10 text-primary':'bg-muted text-muted-foreground'}`}>{status==='DRAFT'&&needsCorrection?'Needs Correction':status==='HR_APPROVED'?'Pending Admin Approval':readable(status)}</span>;
}

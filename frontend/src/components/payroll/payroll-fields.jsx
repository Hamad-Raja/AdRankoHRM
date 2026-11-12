import {cloneElement, useId, useState} from 'react';
import {readable} from './payroll-format';

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
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status==='PAID'||status==='APPROVED'?'bg-primary/10 text-primary':'bg-muted text-muted-foreground'}`}>{status==='DRAFT'&&needsCorrection?'Needs Correction':readable(status)}</span>;
}

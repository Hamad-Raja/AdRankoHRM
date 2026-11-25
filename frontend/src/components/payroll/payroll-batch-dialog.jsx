import {Badge} from '@/components/ui/badge';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/context/auth-context';
import {payrollRequest} from '@/services/payroll.service';
import {Adjustments} from './payroll-draft-dialog';
import {Button} from '@/components/ui/button';
import Dialog from './payroll-dialog';
import {PayrollField} from './payroll-fields';
import {inputClass,pkr} from './payroll-format';
function itemTotal(items){
 let sum=0n;
 for(const item of items){if(!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(item.amount)||item.amount.length>16)return 'Incomplete amounts';const [whole,fraction='']=item.amount.split('.');const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));if(amount===0n)return 'Incomplete amounts';sum+=amount;}
 return pkr(`${sum/100n}.${String(sum%100n).padStart(2,'0')}`);
}
const lines=items=>items.map(({key,...item})=>{void key;return item;});
function PreparationEmployee({row,value,onChange,disabled,failure,month}){
 const {getCsrfToken}=useAuth(),section=useRef(null),pending=useRef(null),panels=useRef({});
 const [expanded,setExpanded]=useState({earnings:false,deductions:false}),[preview,setPreview]=useState(null),[previewError,setPreviewError]=useState(null),[calculating,setCalculating]=useState(null);
 const input={employeeId:value.employeeId,month,totalPayableDays:value.totalPayableDays,workedDays:value.workedDays,earnings:lines(value.earnings),deductions:lines(value.deductions)};
 const signature=JSON.stringify(input),previewBusy=calculating===signature,visiblePreview=preview?.signature===signature?preview.data:null;
 const problem=(previewError?.signature===signature?previewError.error:null)||failure,field=problem?.details?.field;
 useEffect(()=>{pending.current?.abort();pending.current=null;},[signature]);
 useEffect(()=>()=>pending.current?.abort(),[]);
 useEffect(()=>{const panel=panels.current[field?.split('.')[0]];if(panel)panel.open=true;},[field,problem]);
 const fieldError=name=>field===name?(problem.message||problem.reason):undefined;
 async function calculate(){
  if(pending.current||disabled)return;
  for(const control of section.current.querySelectorAll('input,select')){if(control.name==='preparationNote')continue;if(!control.checkValidity()){const details=control.closest('details');if(details)details.open=true;control.reportValidity();return;}}
  const controller=new AbortController();pending.current=controller;setCalculating(signature);setPreview(null);setPreviewError(null);
  try{const data=await payrollRequest('/preview',{method:'POST',body:input,csrfToken:getCsrfToken(),signal:controller.signal});if(!controller.signal.aborted){if(data.salaryVersionId!==value.expectedSalaryVersionId)throw new Error('Applicable salary changed. Close and reload payroll before preparing.');setPreview({signature,data});}}
  catch(error){if(!controller.signal.aborted)setPreviewError({signature,error});}
  finally{if(pending.current===controller){pending.current=null;setCalculating(null);}}
 }
 return <section ref={section} aria-label={'Preparation - '+row.employee.employeeCode} className="min-w-0 space-y-3 rounded-xl border p-4">
  <header className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="break-words font-semibold">{row.employee.fullName}</h3><p className="text-xs text-muted-foreground">{row.employee.employeeCode}</p></div><p className="text-sm">Monthly basic: {pkr(row.monthlyBasic)}</p></header>
  {problem&&<p role="alert" className="break-words text-sm text-destructive">{problem.message||problem.reason}</p>}
  <div className="grid gap-3 sm:grid-cols-2"><PayrollField label={'Total payable days - '+row.employee.employeeCode} error={fieldError('totalPayableDays')}><input className={inputClass} required type="number" min="0.01" max="31" step="0.01" value={value.totalPayableDays} onChange={e=>onChange('totalPayableDays',e.target.value)}/></PayrollField><PayrollField label={'Worked days - '+row.employee.employeeCode} error={fieldError('workedDays')}><input className={inputClass} required type="number" min="0" max={value.totalPayableDays||'31'} step="0.01" value={value.workedDays} onChange={e=>onChange('workedDays',e.target.value)}/></PayrollField></div>
  {['earnings','deductions'].map(kind=><details key={kind} ref={node=>{panels.current[kind]=node;}} open={expanded[kind]} onToggle={event=>{const open=event.currentTarget.open;setExpanded(old=>old[kind]===open?old:{...old,[kind]:open});}} className="min-w-0 rounded-xl border p-3"><summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{kind==='earnings'?'Additional earnings':'Deductions'} ({value[kind].length}) - {itemTotal(value[kind])}</summary><div className="mt-3"><Adjustments kind={kind} withReasons items={value[kind]} disabled={disabled} onChange={items=>onChange(kind,items)} fieldError={fieldError} error={field?.startsWith(kind)?problem.message||problem.reason:undefined}/></div></details>)}
  <section aria-label={'Calculation preview - '+row.employee.employeeCode} className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Calculation preview</h4><Button type="button" variant="outline" disabled={disabled||previewBusy} onClick={()=>void calculate()}>{previewBusy?'Calculating...':'Calculate preview'}</Button></div>
  {visiblePreview?<dl className="grid gap-3 sm:grid-cols-2">{[['Earned basic',visiblePreview.earnedBasic],['Unearned basic (reference only)',visiblePreview.unearnedBasic],['Additional earnings',visiblePreview.additionalEarnings],['Explicit deductions',visiblePreview.totalDeductions],['Net payable',visiblePreview.netPay]].map(([label,amount])=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-semibold tabular-nums">{pkr(amount)}</dd></div>)}</dl>:<p className="text-muted-foreground">Enter complete days and adjustment items, then calculate. Changed inputs require a new preview.</p>}
  <p className="text-xs text-muted-foreground">Unearned basic is the portion excluded by proration, not an additional deduction.</p></section>
  <PayrollField label={'Preparation note - '+row.employee.employeeCode} error={fieldError('reason')}><input name="preparationNote" className={inputClass} required maxLength={1000} value={value.reason} onChange={e=>onChange('reason',e.target.value)}/></PayrollField>
 </section>;
}

export default function PayrollBatchDialog({batch,busy,error,uncertain,onReload,onClose,onPrepare,onReview}){
 const [values,setValues]=useState(()=>batch.rows.map(row=>({employeeId:row.employee.id,expectedSalaryVersionId:row.salaryVersionId,operationKey:crypto.randomUUID(),totalPayableDays:'',workedDays:'',reason:'',earnings:[],deductions:[]})));
 function change(index,key,value){setValues(old=>old.map((row,i)=>i===index?{...row,[key]:value,operationKey:crypto.randomUUID()}:row));}
 const [editingFailures,setEditingFailures]=useState(false),[reviewTarget,setReviewTarget]=useState(null);
 const result=editingFailures?null:batch.result;
 const activeValues=editingFailures?values.filter(row=>batch.result.results.some(item=>item.employeeId===row.employeeId&&item.outcome==='FAILED')):values;
 const dirty=(!result||result.failed>0)&&values.some(row=>row.totalPayableDays||row.workedDays||row.reason||row.earnings.length||row.deductions.length);
 function failureFor(value){const index=activeValues.indexOf(value);if(error?.details?.field?.startsWith('items.'+index+'.'))return {...error,details:{field:error.details.field.split('.').slice(2).join('.')}};return editingFailures?batch.result.results.find(row=>row.employeeId===value.employeeId&&row.outcome==='FAILED'):null;}
 return <Dialog title={result?'Draft preparation results':'Prepare payroll drafts'} description={batch.month+' - '+batch.rows.length+' selected employees'} confirmDiscard dirty={dirty} wide busy={busy} error={error} uncertain={uncertain} onReload={onReload} onClose={onClose} returnFocus={batch.opener}>
 {close=><form className="flex min-h-0 flex-col overflow-hidden" onInvalidCapture={event=>{const details=event.target.closest('details');if(details)details.open=true;}} onSubmit={async event=>{event.preventDefault();const saved=await onPrepare({month:batch.month,items:activeValues.map(row=>({...row,earnings:lines(row.earnings),deductions:lines(row.deductions)}))});if(saved)setEditingFailures(false);}}><div className="min-h-0 space-y-4 overflow-y-auto pb-4">
 {result?<><dl className="grid grid-cols-3 gap-3">{[['Created',result.created],['Skipped',result.skipped],['Failed',result.failed]].map(([label,value])=><div key={label} className={'rounded-xl border p-3 '+(label==='Created'?'border-primary/30 bg-primary/5':label==='Failed'?'border-destructive/30 bg-destructive/5':'bg-muted/30')}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[32rem] text-left text-sm"><thead className="border-b bg-muted/40"><tr>{['Employee','Code','Result'].map(label=><th key={label} className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y">{result.results.map(row=>{const employee=batch.rows.find(item=>item.employee.id===row.employeeId)?.employee;return <tr key={row.employeeId}><td className="p-3">{employee?.fullName}</td><td className="p-3">{employee?.employeeCode}</td><td className="p-3"><Badge variant="outline" className={row.outcome==='CREATED'?'border-primary/30 bg-primary/10 text-primary':row.outcome==='FAILED'?'border-destructive/30 bg-destructive/10 text-destructive':''}>{({CREATED:'Created',SKIPPED:'Skipped',FAILED:'Failed'})[row.outcome]}</Badge><p className="mt-1 break-words text-muted-foreground">{row.reason}</p>{row.outcome==='FAILED'&&<Button type="button" variant="outline" size="sm" onClick={()=>setReviewTarget(row.employeeId)}>Review employee</Button>}</td></tr>;})}</tbody></table></div><p className="text-sm text-muted-foreground">Existing payroll records were not overwritten. Draft preparation does not approve payroll or record payment.</p></>:<><p className="rounded-xl border bg-primary/5 p-3 text-sm">Review each employee's payable and worked days. No full-attendance defaults are assumed. Existing calculation rules apply.</p><fieldset disabled={busy||uncertain} className="space-y-4">{values.map((value,index)=>activeValues.includes(value)&&<PreparationEmployee key={value.employeeId} row={batch.rows[index]} month={batch.month} value={value} disabled={busy||uncertain} failure={failureFor(value,index)} onChange={(key,item)=>change(index,key,item)}/>)}</fieldset></>}
 </div><footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>{result?'Close':'Cancel'}</Button>{result?.failed>0&&<Button type="button" variant="outline" disabled={busy||uncertain} onClick={()=>setEditingFailures(true)}>Correct failed employees</Button>}{!result&&<Button type="submit" disabled={busy||uncertain}>{busy?'Preparing...':'Prepare '+activeValues.length+(activeValues.length===1?' draft':' drafts')}</Button>}</footer>{reviewTarget&&<Dialog title="Review employee salary?" description="Opening salary information will discard the unsaved preparation inputs in this dialog." busy={busy} onClose={()=>setReviewTarget(null)}>{cancel=><footer className="flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" onClick={cancel}>Keep preparation</Button><Button type="button" onClick={()=>onReview(reviewTarget)}>Review employee</Button></footer>}</Dialog>}</form>}
 </Dialog>;
}

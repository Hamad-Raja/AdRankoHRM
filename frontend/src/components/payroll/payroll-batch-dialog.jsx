import {usePreparationAttendance} from './use-payroll-resource';
import {PreparationHeader,AdjustmentSummary,PreparationPreview,AttendanceSummary} from './payroll-preparation-parts';
import {Badge} from '@/components/ui/badge';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/context/auth-context';
import {payrollRequest} from '@/services/payroll.service';
import {Adjustments} from './payroll-draft-dialog';
import {Button} from '@/components/ui/button';
import Dialog from './payroll-dialog';
import {PayrollField} from './payroll-fields';
import {inputClass,adjustmentTotal as itemTotal,preparationMonth} from './payroll-format';
const lines=items=>items.map(({key,...item})=>{void key;return item;});
function PreparationEmployee({row,value,onChange,disabled,failure,month,position,total,attendance}){
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
 return <section ref={section} aria-label={'Preparation - '+row.employee.employeeCode} className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs">
  <PreparationHeader employee={row.employee} monthlyBasic={row.monthlyBasic} position={position} total={total}/>
  {problem&&<p role="alert" className="break-words text-sm text-destructive">{problem.message||problem.reason}</p>}
  <AttendanceSummary employee={row.employee} month={month} resource={attendance}/>
  <div className="grid gap-3 sm:grid-cols-2"><PayrollField label={'Total payable days - '+row.employee.employeeCode} error={fieldError('totalPayableDays')}><input className={inputClass} required type="number" min="0.01" max="31" step="0.01" value={value.totalPayableDays} onChange={e=>onChange('totalPayableDays',e.target.value)}/></PayrollField><PayrollField label={'Worked days - '+row.employee.employeeCode} error={fieldError('workedDays')}><input className={inputClass} required type="number" min="0" max={value.totalPayableDays||'31'} step="0.01" value={value.workedDays} onChange={e=>onChange('workedDays',e.target.value)}/></PayrollField></div>
  {['earnings','deductions'].map(kind=><details key={kind} ref={node=>{panels.current[kind]=node;}} open={expanded[kind]} onToggle={event=>{const open=event.currentTarget.open;setExpanded(old=>old[kind]===open?old:{...old,[kind]:open});}} className="group min-w-0 rounded-xl border border-border"><AdjustmentSummary kind={kind} count={value[kind].length} total={itemTotal(value[kind])}/><div className="border-t border-border p-3"><Adjustments kind={kind} compact withReasons items={value[kind]} disabled={disabled} onChange={items=>onChange(kind,items)} fieldError={fieldError} error={field?.startsWith(kind)?problem.message||problem.reason:undefined}/></div></details>)}
  <PreparationPreview label={'Calculation preview - '+row.employee.employeeCode} preview={visiblePreview}><Button type="button" variant="outline" disabled={disabled||previewBusy} onClick={()=>void calculate()}>{previewBusy?'Calculating...':'Calculate preview'}</Button></PreparationPreview>
  <PayrollField label={'Preparation note - '+row.employee.employeeCode} error={fieldError('reason')}><input name="preparationNote" className={inputClass} required maxLength={1000} value={value.reason} onChange={e=>onChange('reason',e.target.value)}/></PayrollField>
 </section>;
}

export default function PayrollBatchDialog({batch,busy,error,uncertain,onReload,onClose,onPrepare,onReview}){
 const [values,setValues]=useState(()=>batch.rows.map(row=>({employeeId:row.employee.id,expectedSalaryVersionId:row.salaryVersionId,operationKey:crypto.randomUUID(),totalPayableDays:'',workedDays:'',reason:'',earnings:[],deductions:[]})));
 function change(index,key,value){setValues(old=>old.map((row,i)=>i===index?{...row,[key]:value,operationKey:crypto.randomUUID()}:row));}
 const [editingFailures,setEditingFailures]=useState(false),[reviewTarget,setReviewTarget]=useState(null);
 const result=editingFailures?null:batch.result;
 const activeValues=editingFailures?values.filter(row=>batch.result.results.some(item=>item.employeeId===row.employeeId&&item.outcome==='FAILED')):values;
 const attendance=usePreparationAttendance(result?[]:activeValues.map(row=>row.employeeId),batch.month);
 const dirty=(!result||result.failed>0)&&values.some(row=>row.totalPayableDays||row.workedDays||row.reason||row.earnings.length||row.deductions.length);
 function failureFor(value){const index=activeValues.indexOf(value);if(error?.details?.field?.startsWith('items.'+index+'.'))return {...error,details:{field:error.details.field.split('.').slice(2).join('.')}};return editingFailures?batch.result.results.find(row=>row.employeeId===value.employeeId&&row.outcome==='FAILED'):null;}
 return <Dialog title={result?'Draft preparation results':(activeValues.length===1?'Prepare payroll draft':'Prepare payroll drafts')} description={preparationMonth(batch.month)+' - '+(result?batch.rows.length:activeValues.length)+' selected '+((result?batch.rows.length:activeValues.length)===1?'employee':'employees')} confirmDiscard dirty={dirty} wide busy={busy} error={error} uncertain={uncertain} onReload={onReload} onClose={onClose} returnFocus={batch.opener}>
 {close=><form className="flex min-h-0 flex-col overflow-hidden" onInvalidCapture={event=>{const details=event.target.closest('details');if(details)details.open=true;}} onSubmit={async event=>{event.preventDefault();const saved=await onPrepare({month:batch.month,items:activeValues.map(row=>({...row,earnings:lines(row.earnings),deductions:lines(row.deductions)}))});if(saved)setEditingFailures(false);}}><div className="min-h-0 space-y-4 overflow-y-auto pb-4">
 {result?<><dl className="grid grid-cols-3 gap-3">{[['Created',result.created],['Skipped',result.skipped],['Failed',result.failed]].map(([label,value])=><div key={label} className={'rounded-xl border p-3 '+(label==='Created'?'border-primary/30 bg-primary/5':label==='Failed'?'border-destructive/30 bg-destructive/5':'bg-muted/30')}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[32rem] text-left text-sm"><thead className="border-b bg-muted/40"><tr>{['Employee','Code','Result'].map(label=><th key={label} className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y">{result.results.map(row=>{const employee=batch.rows.find(item=>item.employee.id===row.employeeId)?.employee;return <tr key={row.employeeId}><td className="p-3">{employee?.fullName}</td><td className="p-3">{employee?.employeeCode}</td><td className="p-3"><Badge variant="outline" className={row.outcome==='CREATED'?'border-primary/30 bg-primary/10 text-primary':row.outcome==='FAILED'?'border-destructive/30 bg-destructive/10 text-destructive':''}>{({CREATED:'Created',SKIPPED:'Skipped',FAILED:'Failed'})[row.outcome]}</Badge><p className="mt-1 break-words text-muted-foreground">{row.reason}</p>{row.outcome==='FAILED'&&<Button type="button" variant="outline" size="sm" onClick={()=>setReviewTarget(row.employeeId)}>Review employee</Button>}</td></tr>;})}</tbody></table></div><p className="text-sm text-muted-foreground">Existing payroll records were not overwritten. Draft preparation does not approve payroll or record payment.</p></>:<><p className="rounded-xl border bg-primary/5 p-3 text-sm">Review each employee's payable and worked days. No full-attendance defaults are assumed. Existing calculation rules apply.</p><fieldset disabled={busy||uncertain} className="space-y-5">{values.map((value,index)=>activeValues.includes(value)&&<PreparationEmployee key={value.employeeId} row={batch.rows[index]} attendance={attendance} month={batch.month} position={activeValues.indexOf(value)+1} total={activeValues.length} value={value} disabled={busy||uncertain} failure={failureFor(value,index)} onChange={(key,item)=>change(index,key,item)}/>)}</fieldset></>}
 </div><footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>{result?'Close':'Cancel'}</Button>{result?.failed>0&&<Button type="button" variant="outline" disabled={busy||uncertain} onClick={()=>setEditingFailures(true)}>Correct failed employees</Button>}{!result&&<Button type="submit" disabled={busy||uncertain}>{busy?'Preparing...':activeValues.length===1?'Prepare draft':'Prepare '+activeValues.length+' drafts'}</Button>}</footer>{reviewTarget&&<Dialog title="Review employee salary?" description="Opening salary information will discard the unsaved preparation inputs in this dialog." busy={busy} onClose={()=>setReviewTarget(null)}>{cancel=><footer className="flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" onClick={cancel}>Keep preparation</Button><Button type="button" onClick={()=>onReview(reviewTarget)}>Review employee</Button></footer>}</Dialog>}</form>}
 </Dialog>;
}

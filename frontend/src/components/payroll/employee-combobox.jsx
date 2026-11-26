import {FieldInput} from '@/components/ui/field-input';
import {useEffect, useId, useState} from 'react';
import {Search, X, Check} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {apiRequest} from '@/lib/api';
import {useAuth} from '@/context/auth-context';
import {usePayrollResource} from './use-payroll-resource';
import {inputClass} from './payroll-format';

async function directory(path,options){return (await apiRequest(path,options)).data;}
const label=employee=>`${employee.fullName} — ${employee.employeeCode}`;

export default function EmployeeCombobox({selected,onSelect,disabled}) {
  const id=useId(),{refreshSession}=useAuth();
  const [query,setQuery]=useState(''),[page,setPage]=useState(1),[open,setOpen]=useState(false),[highlight,setHighlight]=useState(null);
  const path='/employees?'+new URLSearchParams({q:query,page:String(page),pageSize:'20'});
  const resource=usePayrollResource(open?path:null,directory);
  const employees=resource.data?.employees||[],pagination=resource.data?.pagination;
  const active=highlight?.path===path?highlight.index:-1;
  useEffect(()=>{if(resource.error&&(resource.error.status===401||resource.error.code==='PASSWORD_CHANGE_REQUIRED'))void refreshSession();},[resource.error,refreshSession]);
  useEffect(()=>{if(open&&active>=0)document.getElementById(id+'-option-'+active)?.scrollIntoView({block:'nearest'});},[open,active,id,path]);
  function select(employee){onSelect(employee);setQuery('');setPage(1);setHighlight(null);setOpen(false);}
  function keyDown(event){
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);setHighlight(null);return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();setOpen(true);
      if(employees.length)setHighlight({path,index:event.key==='ArrowDown'?(active+1)%employees.length:(active<=0?employees.length-1:active-1)});
    }else if(event.key==='Enter'&&open){event.preventDefault();if(active>=0&&employees[active])select(employees[active]);}
  }
  return <div className="relative min-w-0 space-y-1.5" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <label htmlFor={id} className="block text-sm font-medium">Search Employee</label>
    <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"/>
      <FieldInput id={id} role="combobox" autoComplete="off" maxLength={120} disabled={disabled} aria-autocomplete="list" aria-expanded={open} aria-controls={open?id+'-results':undefined} aria-activedescendant={open&&active>=0&&employees[active]?id+'-option-'+active:undefined} aria-describedby={id+'-help'} className={`${inputClass} pl-10 pr-12`} placeholder="Search employee by name or employee code..." value={open?query:selected?label(selected):query} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setPage(1);setHighlight(null);setOpen(true);onSelect(null);}} onKeyDown={keyDown}/>
      {(selected||query)&&<Button type="button" variant="ghost" size="icon" className="absolute right-1 top-0.5" aria-label="Clear selection" disabled={disabled} onClick={()=>{select(null);}}><X aria-hidden="true"/></Button>}
    </div>
    <p id={id+'-help'} className="text-xs text-muted-foreground">Search all employees. Use arrow keys and Enter to select.</p>
    {open&&<div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-border bg-card p-2 shadow-xl">
      <ul id={id+'-results'} role="listbox" aria-label="Matching employees" aria-busy={resource.loading} className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
        {employees.map((employee,index)=><li key={employee.id} id={id+'-option-'+index} role="option" aria-selected={selected?.id===employee.id} className={`relative cursor-pointer rounded-lg px-3 py-2 pr-9 text-sm ${active===index||selected?.id===employee.id?'bg-primary/15 text-foreground':'hover:bg-primary/15'}`} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setHighlight({path,index})} onClick={()=>select(employee)}><span className="block font-medium">{employee.fullName}</span><span className="text-xs text-muted-foreground">{employee.employeeCode}</span>{selected?.id===employee.id&&<Check aria-hidden="true" className="absolute right-3 top-3 size-4 text-primary"/>}</li>)}
      </ul>
      {resource.loading?<p role="status" className="p-3 text-sm text-muted-foreground">Searching employees…</p>:resource.error?<div role="alert" className="space-y-2 p-3 text-sm text-destructive"><p>Employee search unavailable. {resource.error.message}</p><Button type="button" variant="outline" onClick={()=>void resource.reload().catch(()=>{})}>Retry search</Button></div>:!employees.length?<p role="status" className="p-3 text-sm text-muted-foreground">No matching employees.</p>:<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2 text-xs text-muted-foreground"><span>{pagination.total} matches · Page {page} of {Math.max(1,pagination.totalPages)}</span><div className="flex gap-2"><Button type="button" variant="outline" disabled={page<=1} onClick={()=>{setPage(value=>value-1);setHighlight(null);}}>Previous results</Button><Button type="button" variant="outline" disabled={page>=pagination.totalPages} onClick={()=>{setPage(value=>value+1);setHighlight(null);}}>Next results</Button></div></div>}
    </div>}
  </div>;
}

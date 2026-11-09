import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertCircle } from 'lucide-react';
import EmployeeForm from '@/components/employees/employee-form';
import { useAuth } from '@/context/auth-context';
import { createEmployee } from '@/services/employee.service';
const uncertainCodes=new Set(['NETWORK_ERROR','REQUEST_TIMEOUT','INVALID_RESPONSE']);
export default function EmployeeCreatePage(){
 const {getCsrfToken,refreshSession}=useAuth(),navigate=useNavigate();
 const [busy,setBusy]=useState(false),[error,setError]=useState(null);
 const lock=useRef(false),alertRef=useRef(null),request=useRef(null);
 useEffect(()=>{if(error)alertRef.current?.focus();},[error]);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function save(data){if(lock.current||error?.uncertain)return;lock.current=true;setBusy(true);setError(null);let started=false;const controller=new AbortController();request.current=controller;
  try{const csrfToken=getCsrfToken();started=true;const employee=await createEmployee(data,{csrfToken,signal:controller.signal});if(!controller.signal.aborted)navigate(`/employees/${employee.id}`,{replace:true,state:{created:true}});}
  catch(failure){if(controller.signal.aborted)return;setError({message:failure.message||'Unable to create employee.',issues:Array.isArray(failure.details)?failure.details:[],uncertain:started&&(uncertainCodes.has(failure.code)||failure.status>=500)});if(failure.status===401||failure.code==='PASSWORD_CHANGE_REQUIRED')void refreshSession();}
  finally{lock.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 return <section className="w-full min-w-0 space-y-5"><header className="space-y-3"><nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link to="/employees" className="rounded focus-visible:outline-2 focus-visible:outline-ring">Employees</Link><span aria-hidden="true" className="mx-3">›</span><span className="text-foreground">Add Employee</span></nav><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add Employee</h1><p className="text-sm text-muted-foreground sm:text-base">Create a new employee, assign their role and organization, and set up their login access.</p></header>
 {error&&<div ref={alertRef} role="alert" tabIndex={-1} className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 focus-visible:outline-2 focus-visible:outline-ring"><AlertCircle aria-hidden="true" className="size-5 shrink-0 text-destructive"/><div className="space-y-2 text-sm"><p>{error.message}</p>{error.issues.map((issue,index)=><p key={index}>{issue.message}</p>)}{error.uncertain&&<p>The save result is unconfirmed. Check the employee directory before another submission. <Link to="/employees" className="text-primary underline">Check employee directory</Link></p>}</div></div>}
 <EmployeeForm onSubmit={save} busy={busy} blocked={error?.uncertain===true} issues={error?.issues||[]}/>
 </section>;
}

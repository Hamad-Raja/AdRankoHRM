import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useLocation,useNavigate,useOutletContext} from 'react-router';
import AppDialog from '@/components/payroll/payroll-dialog';
import EmployeeCreationForm from '@/components/employees/employee-creation-form';
import {useAuth} from '@/context/auth-context';
import {createEmployee} from '@/services/employee.service';
import {registerNavigationGuard} from '@/lib/navigation-guard';

export default function EmployeeCreatePage(){
  const {getCsrfToken,refreshSession}=useAuth(),navigate=useNavigate(),location=useLocation(),{refreshDirectory}=useOutletContext();
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),[dirty,setDirty]=useState(false);
  const lock=useRef(false),request=useRef(null),allowLeave=useRef(false),submitted=useRef(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
  // BrowserRouter has no data-router blocker. Guard only this modal's known
  // history entry; restore a cancelled POP without notifying the router.
  useLayoutEffect(()=>{
    const entry=window.history.state?.idx;let restoring=false;
    function beforeUnload(event){if(!allowLeave.current&&(dirty||busy||error?.uncertain)){event.preventDefault();event.returnValue='';}}
    function pop(event){
      if(allowLeave.current)return;
      const current=event.state?.idx;
      if(!Number.isInteger(entry)||!Number.isInteger(current)||entry===current){if(restoring){event.stopImmediatePropagation();restoring=false;}return;}
      if(restoring){event.stopImmediatePropagation();window.history.go(entry-current);return;}
      if(busy||((dirty||error?.uncertain)&&!window.confirm(error?.uncertain?'A save may have completed. Leave this form and review the employee directory?':'Discard unsaved employee information?'))){event.stopImmediatePropagation();restoring=true;window.history.go(entry-current);}
    }
    window.addEventListener('beforeunload',beforeUnload);const unregister=registerNavigationGuard(pop);
    return()=>{window.removeEventListener('beforeunload',beforeUnload);unregister();};
  },[dirty,busy,error?.uncertain]);
  function close(){allowLeave.current=true;if(location.state?.employeeCreateFromDirectory)navigate(-1);else navigate('/employees'+location.search,{replace:true});}
  function reviewDirectory(){allowLeave.current=true;refreshDirectory();const params=new URLSearchParams({q:submitted.current?.fullName||'',page:'1'});navigate('/employees?'+params.toString(),{replace:true,state:{creationUnconfirmed:true}});}
  async function save(data){
    if(lock.current||error?.uncertain)return null;
    lock.current=true;setBusy(true);setError(null);submitted.current=data;
    const controller=new AbortController();request.current=controller;let started=false;
    try{
      const csrfToken=getCsrfToken();started=true;
      const employee=await createEmployee(data,{csrfToken,signal:controller.signal});
      if(!alive.current||controller.signal.aborted)return null;
      allowLeave.current=true;navigate(`/employees/${employee.id}`,{replace:true,state:{created:true}});return employee;
    }catch(failure){
      if(!alive.current||controller.signal.aborted)return null;
      const issue={message:failure.message||'Unable to create employee.',issues:Array.isArray(failure.details)?failure.details:[],uncertain:started&&(!failure.status||failure.status>=500||['NETWORK_ERROR','REQUEST_TIMEOUT','INVALID_RESPONSE'].includes(failure.code))};
      setError(issue);if(failure.status===401||failure.code==='PASSWORD_CHANGE_REQUIRED')void refreshSession();return issue;
    }finally{lock.current=false;if(alive.current&&!controller.signal.aborted)setBusy(false);}
  }
  return <AppDialog title="Add New Employee" description="Create an employee and login, then optionally set their starting salary." busy={busy} dirty={dirty} uncertain={error?.uncertain} error={error} onReload={reviewDirectory} recoveryLabel="Check employee directory" recoveryDescription="Check whether this employee was created before starting another request. No automatic retry was sent." onClose={close}>
    {safeClose=><EmployeeCreationForm busy={busy} blocked={error?.uncertain===true} onSave={save} onClose={safeClose} onDirtyChange={setDirty}/>}
  </AppDialog>;
}

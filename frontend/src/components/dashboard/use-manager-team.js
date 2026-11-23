import {useCallback,useEffect,useState} from 'react';
import {apiRequest} from '@/lib/api';
export function useManagerTeam(date,personal,revision,onAuthFailure){
 const [attempt,setAttempt]=useState(0),[result,setResult]=useState(null),ownKey=personal?.state==='LINKED'?personal.employee.employeeCode:personal?.state,key=[date,ownKey,revision,attempt].join(':');
 const retry=useCallback(()=>setAttempt(value=>value+1),[]);
 useEffect(()=>{if(!date||!personal)return;const controller=new AbortController();
  async function load(){const query=new URLSearchParams({dateFrom:date,dateTo:date,pageSize:'5'}),{data}=await apiRequest('/dashboard/team-attendance?'+query,{signal:controller.signal});if(data.scope!=='DATED_TEAM'||data.ownExcluded!==true||data.date!==date||!Array.isArray(data.rows)||data.rows.length>5||!Number.isSafeInteger(data.total)||data.total<data.rows.length)throw new Error('Dated team preview could not be verified.');return data;}
  void load().then(data=>{if(!controller.signal.aborted)setResult({key,data});}).catch(error=>{if(!controller.signal.aborted){setResult({key,error});if(error.status===401||error.code==='PASSWORD_CHANGE_REQUIRED')onAuthFailure();}});return()=>controller.abort();
 },[date,personal,revision,attempt,key,onAuthFailure]);
 return {data:result?.key===key?result.data:null,error:result?.key===key?result.error:null,loading:!!date&&!!personal&&result?.key!==key,retry};
}

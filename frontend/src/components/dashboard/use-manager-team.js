import {useCallback,useEffect,useState} from 'react';
import {getReport} from '@/services/reports.service';
import {teamSnapshot} from './personal-dashboard-data';
export function useManagerTeam(date,personal,revision,onAuthFailure){
 const [attempt,setAttempt]=useState(0),[result,setResult]=useState(null),ownKey=personal?.state==='LINKED'?personal.employee.employeeCode:personal?.state,key=[date,ownKey,revision,attempt].join(':');
 const retry=useCallback(()=>setAttempt(value=>value+1),[]);
 useEffect(()=>{if(!date||!personal)return;const controller=new AbortController();
  async function load(){const query=new URLSearchParams({dateFrom:date,dateTo:date,pageSize:'100'}),first=await getReport('attendance',query.toString(),{signal:controller.signal});if(first.total>2000)throw new Error('Team report exceeds the supported daily limit. Open Reports.');const rows=[...first.rows];for(let page=2;page<=first.totalPages;page++){query.set('page',String(page));const next=await getReport('attendance',query.toString(),{signal:controller.signal});if(next.total!==first.total||JSON.stringify(next.totals)!==JSON.stringify(first.totals))throw new Error('Team report changed. Refresh to reconcile.');rows.push(...next.rows);}return teamSnapshot({...first,rows},personal);}
  void load().then(data=>{if(!controller.signal.aborted)setResult({key,data});}).catch(error=>{if(!controller.signal.aborted){setResult({key,error});if(error.status===401||error.code==='PASSWORD_CHANGE_REQUIRED')onAuthFailure();}});return()=>controller.abort();
 },[date,personal,revision,attempt,key,onAuthFailure]);
 return {data:result?.key===key?result.data:null,error:result?.key===key?result.error:null,loading:!!date&&!!personal&&result?.key!==key,retry};
}

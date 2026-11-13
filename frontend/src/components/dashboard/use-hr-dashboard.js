import {useEffect,useRef,useState,useCallback} from 'react';
import {apiRequest} from '@/lib/api';
import {getMyShift,getAttendanceSettings} from '@/services/attendance-settings.service';
import {validDate} from '@/lib/reports';
import {number} from './hr-dashboard-data';
import {getReport} from '@/services/reports.service';
import {periodDates,publishedPolicyAvailable} from './hr-dashboard-data';
export function useHrRead(path,revision,onAuthFailure){
 const [attempt,setAttempt]=useState(0),[result,setResult]=useState(null),key=path+':'+revision+':'+attempt;
 const retry=useCallback(()=>setAttempt(v=>v+1),[]);
 useEffect(()=>{if(!path)return;const controller=new AbortController();void (path==='/attendance-settings/my-shift'?getMyShift({signal:controller.signal}).then(data=>({data})):path==='/attendance-settings'?getAttendanceSettings({signal:controller.signal}).then(data=>({data})):path.startsWith('/reports/attendance?')?getReport('attendance',path.split('?')[1],{signal:controller.signal}).then(data=>({data})):apiRequest(path,{signal:controller.signal})).then(response=>{const data=response.data;if(path==='/dashboard/employees'&&(!number(data?.totalProfiles)||!data.statuses||!Object.values(data.statuses).every(number)||!validDate(data.dutyDate)||!validDate(data.date)||!number(data.eligibleEmployment)||!number(data.statuses.ACTIVE)||!number(data.statuses.EXITED)||!Number.isFinite(Date.parse(data.asOf))))throw new Error('Employee overview could not be verified.');if(path.startsWith('/dashboard/queues')&&!['pendingCorrections','draftPayroll','reviewableLeaves','pendingLeavesOverall'].every(key=>number(data?.[key])))throw new Error('Work queue totals could not be verified.');if(path==='/organization/scope/employees'&&!Array.isArray(data))throw new Error('Department population could not be verified.');if(!controller.signal.aborted)setResult({key,data});}).catch(error=>{if(!controller.signal.aborted){setResult({key,error});if(error.status===401||error.code==='PASSWORD_CHANGE_REQUIRED')onAuthFailure();}});return()=>controller.abort();},[path,key,onAuthFailure]);
 return {data:result?.key===key?result.data:null,error:result?.key===key?result.error:null,loading:!!path&&result?.key!==key,retry};
}
export function useHrAttendance(anchor,period,revision,onAuthFailure,versions){
 const [attempt,setAttempt]=useState(0),[result,setResult]=useState(null),cache=useRef({revision:null,days:new Map()}),key=[anchor,period,revision,attempt].join(':');
 const retry=useCallback(()=>setAttempt(v=>v+1),[]);
 useEffect(()=>{if(!anchor||!versions)return;const controller=new AbortController();if(cache.current.revision!==revision+':'+attempt)cache.current={revision:revision+':'+attempt,days:new Map()};const days=cache.current.days,dates=versions.length?periodDates(anchor,period):[anchor];let next=0;
 async function worker(){while(next<dates.length&&!controller.signal.aborted){const date=dates[next++];if(days.has(date))continue;const report=await getReport('attendance',new URLSearchParams({dateFrom:date,dateTo:date,pageSize:'1'}).toString(),{signal:controller.signal});if(!controller.signal.aborted)days.set(date,report);}}
 void Promise.all(Array.from({length:Math.min(3,dates.length)},worker)).then(()=>{if(!controller.signal.aborted)setResult({key,data:dates.map(date=>({date,report:days.get(date),policyConfirmed:publishedPolicyAvailable(versions,date)}))});}).catch(error=>{if(!controller.signal.aborted){setResult({key,error});controller.abort();if(error.status===401||error.code==='PASSWORD_CHANGE_REQUIRED')onAuthFailure();}});return()=>controller.abort();
 },[anchor,period,revision,attempt,key,onAuthFailure,versions]);
 return {data:result?.key===key?result.data:null,error:result?.key===key?result.error:null,loading:!!anchor&&!!versions&&result?.key!==key,retry};
}

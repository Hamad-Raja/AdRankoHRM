import {useCallback, useEffect, useRef, useState} from 'react';
import {payrollRequest} from '@/services/payroll.service';
import {ApiError} from '@/lib/api';

export function usePayrollResource(path,request=payrollRequest) {
  const [result,setResult]=useState(null);
  const pending=useRef(new Set()), version=useRef(0);
  const reload=useCallback(()=>{
    if(!path)return Promise.resolve(null);
    for(const controller of pending.current)controller.abort();
    pending.current.clear();
    const active=new AbortController(), requestVersion=++version.current;
    pending.current.add(active);
    return request(path,{signal:active.signal}).then(data=>{
      if(data===null||data===undefined)throw new ApiError('The server returned incomplete saved data.',{code:'INVALID_RESPONSE'});
      if(active.signal.aborted||requestVersion!==version.current)return null;
      setResult({path,data,error:null});
      return data;
    }).catch(error=>{
      if(active.signal.aborted||requestVersion!==version.current)return null;
      setResult({path,data:null,error});
      throw error;
    }).finally(()=>pending.current.delete(active));
  },[path,request]);
  useEffect(()=>{
    const requests=pending.current;
    void reload().catch(()=>{});
    return ()=>{for(const controller of requests)controller.abort();requests.clear();};
  },[reload]);
  const current=result?.path===path?result:null;
  return {data:current?.data||null,error:current?.error||null,loading:Boolean(path&&!current),reload};
}

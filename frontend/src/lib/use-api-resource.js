import {useCallback,useEffect,useRef,useState} from 'react';
import {apiRequest} from './api';
export function useApiResource(path){
 const [result,setResult]=useState(null),pending=useRef(null);
 const reload=useCallback(async()=>{pending.current?.abort();if(!path)return null;const c=new AbortController();pending.current=c;try{const payload=await apiRequest(path,{signal:c.signal});if(!c.signal.aborted)setResult({path,data:payload.data});return payload.data;}catch(error){if(!c.signal.aborted){setResult({path,error});throw error;}return null;}},[path]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>active?reload():null).catch(()=>{});return()=>{active=false;pending.current?.abort();};},[reload]);
 const current=result?.path===path?result:null;
 return {data:current?.data,error:current?.error,loading:!!path&&!current,reload};
}

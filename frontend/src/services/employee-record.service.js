import {apiRequest} from '@/lib/api';
// Queries stay only in bounded process memory. Browser history holds an opaque
// key, never the search text; a hard refresh safely loses the sensitive query.
const searches=new Map();
export function rememberRecordSearch(owner,query){const key=crypto.randomUUID();searches.set(key,{owner,query});if(searches.size>40)searches.delete(searches.keys().next().value);return key;}
export function recallRecordSearch(owner,key){const saved=searches.get(key);return saved?.owner===owner?saved.query:'';}
export async function searchEmployeeRecords(filters,csrfToken,signal){return (await apiRequest('/employee-records/search',{method:'POST',body:filters,csrfToken,signal})).data;}
export async function exportEmployeeRecords(filters,csrfToken,signal){const blob=await apiRequest('/employee-records/export',{method:'POST',body:filters,csrfToken,signal,download:true});if(signal.aborted)return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='AdRankoHRM-employee-records.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const employeeRecordPath=(id,section='',filters={})=>'/employee-records/'+encodeURIComponent(id)+(section?'/'+section:'')+(Object.keys(filters).length?'?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==''&&v!==undefined)):'');

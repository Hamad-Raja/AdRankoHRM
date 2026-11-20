import {apiRequest} from '@/lib/api';
export async function searchEmployeeRecords(filters,csrfToken,signal){return (await apiRequest('/employee-records/search',{method:'POST',body:filters,csrfToken,signal})).data;}
export const employeeRecordPath=(id,section='',filters={})=>'/employee-records/'+encodeURIComponent(id)+(section?'/'+section:'')+(Object.keys(filters).length?'?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==''&&v!==undefined)):'');

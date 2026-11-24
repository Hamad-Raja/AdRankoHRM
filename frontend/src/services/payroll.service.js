import {apiRequest} from '@/lib/api';
export async function payrollRequest(path='',options={}) { return (await apiRequest('/payroll'+path,options)).data; }
export function payrollQuery(filters) { return new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==''&&value!==undefined)).toString(); }
export function payrollFile(path,options={}) {return apiRequest('/payroll'+path,{...options,download:true});}
export function savePayrollFile(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

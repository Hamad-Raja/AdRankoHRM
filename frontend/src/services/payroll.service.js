import {apiRequest} from '@/lib/api';
export async function payrollRequest(path='',options={}) { return (await apiRequest('/payroll'+path,options)).data; }
export function payrollQuery(filters) { return new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==''&&value!==undefined)).toString(); }

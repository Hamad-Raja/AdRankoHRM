import {apiRequest} from '@/lib/api';
import {inboxChanged} from '@/lib/module-events';
const query=params=>{const q=new URLSearchParams();for(const [k,v] of Object.entries(params||{}))if(v!==''&&v!=null)q.set(k,String(v));return q.toString();};
export async function leaveRead(path='',params={},options={}){return (await apiRequest(`/leaves${path}?${query(params)}`,options)).data;}
export async function leaveWrite(path,body,options){const result=(await apiRequest(`/leaves${path}`,{...options,method:'POST',body})).data;if(path!=='/preview')inboxChanged();return result;}

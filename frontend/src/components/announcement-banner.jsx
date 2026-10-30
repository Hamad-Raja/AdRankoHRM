import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {useAuth} from '@/context/auth-context';
import {getAnnouncements,markAnnouncementRead} from '@/services/announcement.service';
import {INBOX_CHANGED} from '@/lib/module-events';
export default function AnnouncementBanner(){
 const {user,getCsrfToken}=useAuth(),[rows,setRows]=useState([]),[error,setError]=useState(''),[pending,setPending]=useState(false),lock=useRef(false);
 useEffect(()=>{let alive=true,controller,timer;setRows([]);async function load(){controller?.abort();controller=new AbortController();const ctrl=controller;try{const result=await getAnnouncements({pageSize:5},{signal:ctrl.signal});if(alive&&!ctrl.signal.aborted){const items=result.announcements.filter(a=>a.pinned||['IMPORTANT','HIGH','URGENT'].includes(a.priority)).slice(0,2).map(a=>({...a,ownerId:user.id}));setRows(items);const expiry=items.filter(a=>a.expiresAt).map(a=>Date.parse(a.expiresAt)-Date.now()).filter(v=>v>0);clearTimeout(timer);if(expiry.length)timer=setTimeout(load,Math.min(...expiry,2147483600)+50);}}catch{if(alive&&!ctrl.signal.aborted)setRows([]);}}
  void load();window.addEventListener(INBOX_CHANGED,load);return()=>{alive=false;controller?.abort();clearTimeout(timer);window.removeEventListener(INBOX_CHANGED,load);};},[user.id]);
 async function mark(id){if(lock.current)return;lock.current=true;setPending(true);setError('');try{await markAnnouncementRead(id,{csrfToken:getCsrfToken()});}catch(e){setError(e.message);}finally{lock.current=false;setPending(false);}}
 const visible=rows.filter(a=>a.ownerId===user.id);
 if(!visible.length)return null;
 return <section aria-label="Important announcements" className="space-y-3">{error&&<p role="alert">{error}</p>}{visible.map(a=><article key={a.id} className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4"><h2 className="font-semibold">{a.pinned?'Pinned · ':''}{a.title}</h2><p className="whitespace-pre-wrap break-words text-sm">{a.content}</p><div className="flex flex-wrap items-center gap-3 text-sm"><Link className="text-primary underline" to={`/announcements?id=${a.id}`}>View announcement</Link>{!a.isRead?<button type="button" className="rounded border px-2 py-1" disabled={pending} onClick={()=>mark(a.id)}>Mark read</button>:<span>Read</span>}</div></article>)}<p className="text-xs text-muted-foreground">Read state is not policy acceptance or proof of compliance.</p></section>;
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {useAuth} from '@/context/auth-context';
import {Button} from '@/components/ui/button';
import {getNotifications,markNotificationRead,markAllNotificationsRead,deleteNotification,clearReadNotifications,openNotification} from '@/services/notification.service';
import NotificationGlyph from '@/components/notification-glyph';
import {INBOX_CHANGED} from '@/lib/module-events';

export default function NotificationsPage(){
 const {user,getCsrfToken}=useAuth(),navigate=useNavigate();
 const [loadedData,setData]=useState(null),[error,setError]=useState(''),[page,setPage]=useState(1),[type,setType]=useState(''),[readState,setReadState]=useState('ALL'),[refreshing,setRefreshing]=useState(false),[busy,setBusy]=useState(false);
 const queryKey=JSON.stringify([user.id,page,type,readState]);
 const current=loadedData?.queryKey===queryKey?loadedData:null;
 const data=current&&!current.failed?current:null;
 const loading=refreshing||!current;
 const sequence=useRef(0),controller=useRef(null),lock=useRef(false);
 const fetchData=useCallback(()=>{
  const request=++sequence.current;controller.current?.abort();const ctrl=new AbortController();controller.current=ctrl;
  return getNotifications({page,pageSize:20,type,readState},{signal:ctrl.signal}).then(result=>{
   if(request===sequence.current&&!ctrl.signal.aborted){setData({...result,ownerId:user.id,queryKey});setError('');}
  }).catch(e=>{if(!ctrl.signal.aborted){setData({queryKey,failed:true});setError(e.message);}})
    .finally(()=>{if(request===sequence.current&&!ctrl.signal.aborted)setRefreshing(false);});
 },[user.id,page,type,readState,queryKey]);
 const load=useCallback(()=>{setRefreshing(true);setError('');return fetchData();},[fetchData]);
 useEffect(()=>{void fetchData();window.addEventListener(INBOX_CHANGED,load);return()=>{controller.current?.abort();window.removeEventListener(INBOX_CHANGED,load);};},[load,fetchData]);
 useEffect(()=>{if(!data)return;const next=data.notifications.filter(n=>n.expiresAt).map(n=>Date.parse(n.expiresAt)-Date.parse(data.asOf)).filter(v=>Number.isFinite(v)&&v>0);if(!next.length)return;const timer=setTimeout(load,Math.min(...next,2147483600)+25);return()=>clearTimeout(timer);},[data,load]);
 async function action(work){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work({csrfToken:getCsrfToken()});await load();}catch(e){setError(e.message||'Read action unconfirmed. Reload to reconcile.');}finally{lock.current=false;setBusy(false);}}
 return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Notifications</h1><Button variant="outline" disabled={busy} onClick={load}>Reload inbox</Button></div><p className="text-sm text-muted-foreground">Your private inbox. Dismissal hides a delivery without erasing its event or announcement read history.</p>
 {error&&!loading&&<p role="alert" className="rounded-lg border p-3 text-destructive">{error}</p>}
 <div className="flex flex-wrap gap-3"><label className="text-sm">Read state<select aria-label="Read state" value={readState} onChange={e=>{setReadState(e.target.value);setPage(1);}} className="ml-2 rounded border bg-background p-2">{['ALL','UNREAD','READ'].map(v=><option key={v}>{v}</option>)}</select></label><label className="text-sm">Notification type<select aria-label="Notification type" value={type} onChange={e=>{setType(e.target.value);setPage(1);}} className="ml-2 rounded border bg-background p-2"><option value="">All</option>{['ANNOUNCEMENT','ATTENDANCE','PAYROLL','LEAVE','SYSTEM','INFO','WARNING','SUCCESS'].map(v=><option key={v}>{v}</option>)}</select></label></div>
 <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy||loading} onClick={()=>action(markAllNotificationsRead)}>Mark all read</Button><Button variant="outline" disabled={busy||loading} onClick={()=>action(clearReadNotifications)}>Clear read</Button><span className="self-center text-sm">Unread: {data?.unreadCount??'—'}</span></div>
 {loading?<p role="status">Loading inbox...</p>:!data?.notifications.length?<p>{error?'Inbox unavailable. Reload to retry.':'No active notifications match these filters.'}</p>:<ul className="divide-y rounded-xl border bg-card px-4">{data.notifications.map(n=><li key={n.id} className="space-y-2 py-4"><p className="flex items-center gap-2 font-semibold"><NotificationGlyph type={n.type}/><span>{n.title}</span> {!n.isRead&&<span className="ml-2 text-xs text-primary">Unread</span>}</p><p className="whitespace-pre-wrap text-sm">{n.message}</p><p className="text-xs text-muted-foreground">{n.type} · {new Date(n.createdAt).toLocaleString()}</p><div className="flex flex-wrap gap-2">{n.link&&<Button variant="outline" disabled={busy} onClick={()=>action(async options=>navigate((await openNotification(n.id,options)).link))}>Open notification</Button>}{!n.isRead&&<Button variant="outline" disabled={busy} onClick={()=>action(options=>markNotificationRead(n.id,options))}>Mark read</Button>}<Button variant="outline" disabled={busy} onClick={()=>action(options=>deleteNotification(n.id,options))}>Dismiss</Button></div></li>)}</ul>}
 <div className="flex items-center gap-3"><Button variant="outline" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span className="text-sm">Page {page} of {data?.totalPages||1} · {data?.total||0} notifications</span><Button variant="outline" disabled={loading||page>=(data?.totalPages||1)} onClick={()=>setPage(p=>p+1)}>Next</Button></div>
 </div>;
}

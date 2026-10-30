import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router';
import {Bell} from 'lucide-react';
import {useAuth} from '@/context/auth-context';
import {getNotifications,markAllNotificationsRead,markNotificationRead,deleteNotification,openNotification} from '@/services/notification.service';
import {INBOX_CHANGED} from '@/lib/module-events';
import NotificationGlyph from '@/components/notification-glyph';

export default function NotificationBell(){
 const {user,status,getCsrfToken,refreshSession}=useAuth(),navigate=useNavigate();
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const root=useRef(null),trigger=useRef(null),panel=useRef(null),lock=useRef(false);
 const active=status==='authenticated'&&user&&!user.mustChangePassword;
 useEffect(()=>{
  let disposed=false,running=false,queued=false,restricted=false,timer,controller,nextDelay=30000;
  setData(null);setOpen(false);setError('');
  async function refresh(){
   clearTimeout(timer);if(disposed||restricted||!active||document.visibilityState==='hidden')return;
   if(running){queued=true;return;}running=true;controller=new AbortController();
   try{const result=await getNotifications({pageSize:8},{signal:controller.signal});if(!disposed&&!controller.signal.aborted){setData(result);setError('');const expiries=result.notifications.filter(n=>n.expiresAt).map(n=>Date.parse(n.expiresAt)-Date.parse(result.asOf)).filter(v=>v>0);nextDelay=Math.min(30000,...expiries.map(v=>v+50));}}
   catch(e){if(!disposed&&!controller.signal.aborted){setData(null);setError(e.message||'Notifications unavailable.');if(e.status===401||e.code==='PASSWORD_CHANGE_REQUIRED'){restricted=true;void refreshSession();}}}
   finally{running=false;if(!disposed&&!restricted&&active&&document.visibilityState!=='hidden'){if(queued){queued=false;void refresh();}else timer=setTimeout(refresh,nextDelay);}}
  }
  function visibility(){if(document.visibilityState==='hidden'){clearTimeout(timer);controller?.abort();}else void refresh();}
  void refresh();document.addEventListener('visibilitychange',visibility);window.addEventListener(INBOX_CHANGED,refresh);window.addEventListener('focus',refresh);
  return()=>{disposed=true;controller?.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener(INBOX_CHANGED,refresh);window.removeEventListener('focus',refresh);};
 },[active,user?.id,refreshSession]);
 useEffect(()=>{if(!open)return;panel.current?.focus();function outside(e){if(!root.current?.contains(e.target))setOpen(false);}function escape(e){if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 async function action(work){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work({csrfToken:getCsrfToken()});}catch(e){setError(e.message||'Action unconfirmed. Refresh to reconcile.');}finally{lock.current=false;setBusy(false);}}
 const rows=active?data?.notifications||[]:[],count=active?data?.unreadCount||0:0;
 return <div ref={root} className="relative"><button ref={trigger} type="button" disabled={!active} aria-label={count?`${count} unread notification${count===1?'':'s'}`:'Notifications'} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(v=>!v)} className="relative flex size-9 items-center justify-center rounded-lg border bg-background text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Bell className="size-4" aria-hidden="true"/>{count>0&&<span className="absolute -top-1 -right-1 rounded-full bg-destructive px-1 text-xs text-destructive-foreground">{count>99?'99+':count}</span>}</button>
 {open&&active&&<div ref={panel} tabIndex={-1} role="dialog" aria-label="Recent notifications" className="fixed inset-x-4 top-16 z-50 mt-2 max-h-[75vh] overflow-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl outline-none md:absolute md:inset-x-auto md:right-0 md:top-full md:w-80 lg:w-96">
  <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Notifications</h2><button type="button" aria-label="Close notifications" onClick={()=>{setOpen(false);trigger.current?.focus();}}>Close</button></div>
  {error&&<p role="alert" className="my-2 text-sm text-destructive">{error}</p>}
  <button type="button" disabled={busy} className="my-2 rounded border px-2 py-1 text-xs" onClick={()=>window.dispatchEvent(new Event(INBOX_CHANGED))}>Refresh notifications</button>
  {count>0&&<button type="button" disabled={busy} className="m-2 text-xs underline" onClick={()=>action(markAllNotificationsRead)}>Mark all read</button>}
  {!data&&!error&&<p role="status">Loading notifications...</p>}{data&&!rows.length&&<p className="py-4 text-sm">No active notifications.</p>}
  <ul className="divide-y">{rows.map(n=><li key={n.id} className="space-y-2 py-3 text-sm"><p className="flex items-center gap-2 font-semibold"><NotificationGlyph type={n.type}/>{!n.isRead&&<span aria-label="Unread" className="mr-1 text-primary">●</span>}<span>{n.title}</span></p><p>{n.message}</p><div className="flex flex-wrap gap-3 text-xs">
   {n.link&&<button type="button" disabled={busy} className="underline" onClick={()=>action(async options=>{const target=await openNotification(n.id,options);setOpen(false);navigate(target.link);})}>Open notification</button>}
   {!n.isRead&&<button type="button" disabled={busy} className="underline" onClick={()=>action(options=>markNotificationRead(n.id,options))}>Mark read</button>}
   <button type="button" disabled={busy} className="underline" onClick={()=>action(options=>deleteNotification(n.id,options))}>Dismiss</button>
  </div></li>)}</ul><Link className="mt-3 block text-sm font-semibold text-primary" to="/notifications" onClick={()=>setOpen(false)}>View all notifications</Link>
 </div>}</div>;
}

import {useEffect, useId, useRef} from 'react';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';

export default function PayrollDialog({title,description,wide=false,busy=false,dirty=false,error,uncertain,onReload,onClose,children}) {
  const id=useId(), dialog=useRef(null), opener=useRef(document.activeElement);
  useEffect(()=>{
    const element=dialog.current, previous=opener.current;
    element.showModal();
    return ()=>{element.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  function close() {
    if(busy)return;
    if((dirty||uncertain)&&!window.confirm(uncertain?'A save may already have completed. Close this form and review saved records?':'Discard unsaved changes?'))return;
    onClose();
  }
  function trapFocus(event) {
    if(event.key!=='Tab')return;
    const element=dialog.current;
    const controls=[...element.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[tabindex]')].filter(control=>!control.matches(':disabled')&&control.tabIndex>=0&&control.getClientRects().length);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls.at(-1),active=document.activeElement;
    if(event.shiftKey&&(active===first||!element.contains(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!element.contains(active))){event.preventDefault();first.focus();}
  }
  return <dialog ref={dialog} aria-labelledby={id+'-title'} aria-describedby={id+'-description'} onKeyDown={trapFocus} onCancel={event=>{event.preventDefault();close();}}
    className={`fixed inset-0 m-auto max-h-[94svh] w-[calc(100%-1rem)] overflow-y-auto rounded-2xl border border-border bg-card p-4 text-card-foreground backdrop:bg-black/65 sm:w-[calc(100%-3rem)] sm:p-6 ${wide?'max-w-4xl':'max-w-xl'}`}>
    <header className="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4"><div><h2 id={id+'-title'} className="text-xl font-semibold">{title}</h2><p id={id+'-description'} className="mt-1 text-sm text-muted-foreground">{description}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close dialog" disabled={busy} onClick={close}><X aria-hidden="true"/></Button></header>
    {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error.message||error}</p>}
    {uncertain && <div className="mb-4 space-y-2 rounded-lg border border-border p-3 text-sm"><p>Reload saved records before another write. No automatic retry was sent.</p><Button type="button" variant="outline" disabled={busy} onClick={()=>void onReload()}>Reload saved data</Button></div>}
    {children(close)}
  </dialog>;
}

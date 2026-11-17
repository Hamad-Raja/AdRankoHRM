import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {lockPageScroll} from '@/lib/scroll-lock';

export default function PayrollDialog({title,titleAccessory,description,wide=false,busy=false,dirty=false,error,uncertain,onReload,onClose,returnFocus,confirmDiscard=false,recoveryLabel='Reload saved data',recoveryDescription='Reload saved records before another write. No automatic retry was sent.',className='',children}) {
  const id=useId(), dialog=useRef(null), opener=useRef(returnFocus||document.activeElement);
  const [discard,setDiscard]=useState(false);
  useEffect(()=>{
    const element=dialog.current, previous=opener.current;
    const scroll={left:window.scrollX,top:window.scrollY};
    const unlock=lockPageScroll();
    element.showModal();
    window.scrollTo({...scroll,behavior:'instant'});
    return ()=>{
      element.close();unlock();
      if(previous?.isConnected)previous.focus({preventScroll:true});
      window.scrollTo({...scroll,behavior:'instant'});
    };
  },[]);
  function close() {
    if(busy)return;
    if(confirmDiscard&&(dirty||uncertain)){setDiscard(true);return;}
    if((dirty||uncertain)&&!window.confirm(uncertain?'A save may already have completed. Close this form and review saved records?':'Discard unsaved changes?'))return;
    onClose();
  }
  function trapFocus(event) {
    if(event.key!=='Tab')return;
    const element=dialog.current;
    if(!element.contains(event.target))return;
    const controls=[...element.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[tabindex]')].filter(control=>!control.matches(':disabled')&&control.tabIndex>=0&&control.getClientRects().length);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls.at(-1),active=document.activeElement;
    if(event.shiftKey&&(active===first||!element.contains(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!element.contains(active))){event.preventDefault();first.focus();}
  }
  return createPortal(<dialog ref={dialog} aria-labelledby={id+'-title'} aria-describedby={id+'-description'} onKeyDown={trapFocus} onCancel={event=>{event.preventDefault();event.stopPropagation();close();}}
    className={`payroll-dialog fixed inset-0 m-auto max-h-[94svh] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-[5px] open:flex sm:w-[calc(100%-3rem)] sm:p-6 ${wide?'max-w-5xl':'max-w-xl'} ${className}`}>
    <header className="mb-5 flex shrink-0 items-start justify-between gap-3 border-b border-border pb-4"><div><div className="flex flex-wrap items-center gap-3"><h2 id={id+'-title'} className="text-xl font-semibold">{title}</h2>{titleAccessory}</div><p id={id+'-description'} className="mt-1 text-sm text-muted-foreground">{description}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close dialog" disabled={busy} onClick={close}><X aria-hidden="true"/></Button></header>
    {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error.message||error}</p>}
    {uncertain && <div className="mb-4 space-y-2 rounded-lg border border-border p-3 text-sm"><p>{recoveryDescription}</p><Button type="button" variant="outline" disabled={busy} onClick={()=>void onReload()}>{recoveryLabel}</Button></div>}
    {children(close)}
    {discard&&<PayrollDialog title={uncertain?'Leave unconfirmed action?':'Discard unsaved changes?'} description={uncertain?'A save may already have completed. Review saved records before submitting again.':'Your unsaved changes will be lost. Keep editing to retain them.'} busy={busy} onClose={()=>setDiscard(false)}>
      {cancel=><footer className="flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={busy} onClick={cancel}>Keep editing</Button><Button disabled={busy} onClick={onClose}>{uncertain?'Close and review':'Discard changes'}</Button></footer>}
    </PayrollDialog>}
  </dialog>,document.body);
}

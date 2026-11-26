import {Children,Fragment,isValidElement,useEffect,useRef,useState} from 'react';
import {Select} from '@base-ui/react/select';
import {Check,ChevronDown} from 'lucide-react';
import {cn} from '@/lib/utils';
import {fieldAppearance} from './field-styles';

function textOf(node){return Children.toArray(node).map(child=>isValidElement(child)?textOf(child.props.children):String(child)).join('');}
function optionsOf(children){return Children.toArray(children).flatMap(child=>{
  if(!isValidElement(child))return [];
  if(child.type===Fragment)return optionsOf(child.props.children);
  if(child.type==='optgroup')return optionsOf(child.props.children).map(item=>({...item,disabled:item.disabled||child.props.disabled}));
  if(child.type!=='option')return [];
  return [{value:String(child.props.value??textOf(child.props.children)),label:child.props.label??child.props.children,disabled:Boolean(child.props.disabled),hidden:Boolean(child.props.hidden)}];
});}

export function ThemedSelect({children,options,placeholder,name,value,defaultValue,required,disabled,form,autoComplete,onChange,onInvalid,onInput,className,id,ref:forwardedRef,...props}){
  const items=options?[...(placeholder==null?[]:[{value:'',label:placeholder}]),...options.map(([value,label,disabled])=>({value:String(value),label,disabled}))]:optionsOf(children);
  const initial=String(defaultValue??items.find(item=>!item.disabled)?.value??'');
  const [uncontrolled,setUncontrolled]=useState(initial),[container,setContainer]=useState(null),[open,setOpen]=useState(false);
  const trigger=useRef(null),native=useRef(null),controlled=value!==undefined;
  const selected=controlled?String(value??''):uncontrolled;
  useEffect(()=>{setContainer(trigger.current?.closest('dialog')||document.body);},[]);
  useEffect(()=>{const dialog=trigger.current?.closest('dialog');if(!open||!dialog)return;const cancel=event=>{event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();};dialog.addEventListener('cancel',cancel,true);return()=>dialog.removeEventListener('cancel',cancel,true);},[open]);
  useEffect(()=>{const field=native.current,owner=field?.form;if(!owner)return;const reset=()=>{if(!controlled)setUncontrolled(initial);setOpen(false);};owner.addEventListener('reset',reset);return()=>owner.removeEventListener('reset',reset);},[controlled,initial,form]);
  function change(next){const nextValue=next??'';if(!controlled)setUncontrolled(nextValue);const field=native.current;if(field)field.value=nextValue;const event={target:field,currentTarget:field,type:'change',preventDefault(){},stopPropagation(){}};onChange?.(event);}
  return <>
    <Select.Root value={selected} items={items} disabled={disabled} modal={false} open={open} onOpenChange={(next,details)=>{setOpen(next);if(details.reason==='escape-key'){details.event.preventDefault();details.event.stopPropagation();}}} onValueChange={change}>
      <Select.Trigger {...props} id={id} ref={element=>{trigger.current=element;if(typeof forwardedRef==='function')forwardedRef(element);else if(forwardedRef)forwardedRef.current=element;}} aria-required={required||undefined} className={cn('inline-flex h-9 w-full min-w-0 items-center justify-between gap-3 px-3 py-1.5 text-left data-popup-open:border-primary data-popup-open:ring-2 data-popup-open:ring-primary/30',className,fieldAppearance)}>
        <Select.Value className="min-w-0 flex-1 truncate"/><Select.Icon><ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground"/></Select.Icon>
      </Select.Trigger>
      {container&&<Select.Portal container={container}><Select.Positioner positionMethod="fixed" align="start" sideOffset={8} collisionPadding={12} alignItemWithTrigger={false} className="z-50 w-[var(--anchor-width)] max-w-[calc(100vw-1.5rem)]"><Select.Popup className="max-h-[min(var(--available-height),18rem)] overflow-hidden rounded-xl border border-border bg-card p-2 text-foreground shadow-xl outline-none"><Select.List className="max-h-[min(calc(var(--available-height)_-_1rem),16rem)] space-y-1 overflow-y-auto overscroll-contain">{items.filter(item=>!item.hidden).map(item=><Select.Item key={item.value} value={item.value} disabled={item.disabled} className="relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-primary/15 data-selected:bg-primary/10 data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-60"><Select.ItemText className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.label}</Select.ItemText><Select.ItemIndicator><Check aria-hidden="true" className="size-4 shrink-0 text-primary"/></Select.ItemIndicator></Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal>}
    </Select.Root>
    <select ref={native} name={name} value={selected} required={required} disabled={disabled} form={form} autoComplete={autoComplete} tabIndex={-1} aria-hidden="true" className="sr-only pointer-events-none" onChange={e=>change(e.target.value)} onInput={onInput} onInvalid={e=>{e.preventDefault();trigger.current?.focus();onInvalid?.(e);}}>{items.map(item=><option key={item.value} value={item.value} disabled={item.disabled} hidden={item.hidden}>{item.label}</option>)}</select>
  </>;
}

let owners=0;
let saved;

// Modal dialogs and the mobile navigation can briefly overlap during routing.
// Restore the original styles only after the last owner releases its lock.
export function lockPageScroll(){
  const root=document.documentElement,body=document.body;
  if(owners===0){
    saved={overflow:root.style.overflow,gutter:root.style.scrollbarGutter,bodyOverflow:body.style.overflow};
    if(window.innerWidth>root.clientWidth)root.style.scrollbarGutter='stable';
    root.style.overflow='hidden';body.style.overflow='hidden';
  }
  owners++;let released=false;
  return ()=>{
    if(released)return;released=true;owners--;
    if(owners===0){root.style.overflow=saved.overflow;root.style.scrollbarGutter=saved.gutter;body.style.overflow=saved.bodyOverflow;saved=undefined;}
  };
}

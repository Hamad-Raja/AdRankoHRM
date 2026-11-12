let activeGuard=null;

// Register before BrowserRouter installs its history listener. A late popstate
// listener can run after routing has already unmounted the dirty form.
const handlePop=event=>activeGuard?.(event);
window.addEventListener('popstate',handlePop,true);

export function registerNavigationGuard(guard){
  activeGuard=guard;
  return ()=>{if(activeGuard===guard)activeGuard=null;};
}

if(import.meta.hot)import.meta.hot.dispose(()=>{window.removeEventListener('popstate',handlePop,true);activeGuard=null;});

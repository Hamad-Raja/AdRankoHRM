import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { Outlet, useLocation } from "react-router";

import PortalHeader from "@/layout/portal-header";
import PortalSidebar from "@/layout/portal-sidebar";
import {useAuth} from '@/context/auth-context';
import {lockPageScroll} from '@/lib/scroll-lock';

export default function PortalLayout() {
  const location = useLocation();
  const {user}=useAuth();

  const dialogRef = useRef(null);
  const mainRef = useRef(null);
  const previousPath = useRef(location.pathname);

  const [menuOpen, setMenuOpen] = useState(false);

  const menuId = useId();
  const menuTitleId = useId();

  const closeMenu = useCallback(() => {
    const dialog = dialogRef.current;

    if (dialog?.open) {
      dialog.close();
    }
  }, []);

  const openMenu = useCallback(() => {
    const dialog = dialogRef.current;

    if (dialog && !dialog.open) {
      dialog.showModal();
      setMenuOpen(true);
    }
  }, []);

  useEffect(() => {
    closeMenu();
    const modalNavigation = [previousPath.current,location.pathname].every(path=>path==='/employees'||path==='/employees/new') && previousPath.current!==location.pathname;
    previousPath.current=location.pathname;
    if(modalNavigation)return;
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname, closeMenu]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 64rem)");

    function handleViewportChange(event) {
      if (event.matches) {
        closeMenu();
      }
    }

    desktopQuery.addEventListener("change", handleViewportChange);

    return () => {
      desktopQuery.removeEventListener("change", handleViewportChange);
      closeMenu();
    };
  }, [closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;

    return lockPageScroll();
  }, [menuOpen]);

  return (
    <div data-hr-dashboard={user?.role==='HR'&&location.pathname==='/dashboard'?'true':undefined} data-personal-dashboard={location.pathname==='/dashboard'&&['MANAGER','EMPLOYEE'].includes(user?.role)?user.role.toLowerCase():undefined} className="min-h-svh bg-background text-foreground [overflow-wrap:anywhere]">
      <a
        href="#officehr-main"
        className="fixed top-4 left-4 z-50 -translate-y-24 rounded-md bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-md focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-ring"
      >
        Skip to content
      </a>

      <div className="flex min-h-svh">
        <aside
          aria-label="OfficeHR sidebar"
          className="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-sidebar-border lg:block"
        >
          <PortalSidebar />
        </aside>

        <div className="min-w-0 flex-1">
          <PortalHeader
            onOpenMenu={openMenu}
            menuOpen={menuOpen}
            menuId={menuId}
          />

          <main
            id="officehr-main"
            ref={mainRef}
            tabIndex={-1}
            className="mx-auto w-full max-w-[1600px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
          >
            <Outlet />
          </main>
        </div>
      </div>

      <dialog
        id={menuId}
        ref={dialogRef}
        aria-labelledby={menuTitleId}
        onClose={() => setMenuOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = [...event.currentTarget.querySelectorAll(
            'a[href], button:not(:disabled), [tabindex="0"]'
          )].filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left || event.clientX > bounds.right ||
              event.clientY < bounds.top || event.clientY > bounds.bottom
            ) {
              closeMenu();
            }
          }
        }}
        className="fixed inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-72 max-w-[calc(100vw-2rem)] border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground backdrop:bg-black/55 lg:hidden"
      >
        <h2 id={menuTitleId} className="sr-only">
          OfficeHR navigation
        </h2>

        <button
          type="button"
          onClick={closeMenu}
          aria-label="Close navigation"
          className="absolute top-4 right-3 z-10 flex size-10 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        <PortalSidebar onNavigate={closeMenu} />
      </dialog>
    </div>
  );
}

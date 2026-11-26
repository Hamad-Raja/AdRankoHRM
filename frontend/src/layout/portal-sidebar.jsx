import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChartNoAxesColumnIncreasing,
  BriefcaseBusiness,
  ContactRound,
  Network,
  ScrollText,
  Settings2,
  ShieldCheck,
  WalletCards,
  FileText,
  LayoutDashboard,
  Megaphone,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Link, NavLink } from "react-router";
import AdRankoLogo from '@/components/adranko-logo';
import { InitialsAvatar } from '@/components/employees/directory-parts';
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

const ROLE_LABELS = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

const MANAGEMENT_NAVIGATION = [
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Employees",
    to: "/employees",
    icon: UsersRound,
    end: false,
  },
  {
    label: "Organization",
    to: "/organization",
    icon: Network,
  },
  {
    label: "Attendance",
    to: "/attendance",
    icon: CalendarDays,
  },
  {
    label: "Leave Management",
    to: "/leaves",
    icon: CalendarRange,
  },
  {
    label: "Payroll",
    to: "/payroll",
    icon: WalletCards,
  },
  {
    label: "Reports",
    to: "/reports",
    icon: ChartNoAxesColumnIncreasing,
  },
  {
    label: "Announcements",
    to: "/announcements",
    icon: Megaphone,
  },
  {
    label: "Notifications",
    to: "/notifications",
    icon: Bell,
  },
  {
    label: "My Payslips",
    to: "/my-payslips",
    icon: FileText,
  },
  {
    label: "Attendance Settings",
    to: "/attendance-settings",
    icon: Settings2,
  },
];

const MANAGER_NAVIGATION = [
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "My Team",
    to: "/my-employees",
    icon: UsersRound,
  },
  {
    label: "Attendance",
    to: "/attendance",
    icon: CalendarDays,
  },
  {
    label: "My Leave",
    to: "/leaves",
    icon: CalendarRange,
  },
  {
    label: "Reports",
    to: "/reports",
    icon: ChartNoAxesColumnIncreasing,
  },
  {
    label: "My Payslips",
    to: "/my-payslips",
    icon: FileText,
  },
  {
    label: "Announcements",
    to: "/announcements",
    icon: Megaphone,
  },
  {
    label: "Notifications",
    to: "/notifications",
    icon: Bell,
  },
];

const EMPLOYEE_NAVIGATION = [
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "My Attendance",
    to: "/attendance",
    icon: CalendarDays,
  },
  {
    label: "My Leave",
    to: "/leaves",
    icon: CalendarRange,
  },
  {
    label: "My Reports",
    to: "/reports",
    icon: ChartNoAxesColumnIncreasing,
  },
  {
    label: "My Payslips",
    to: "/my-payslips",
    icon: FileText,
  },
  {
    label: "Announcements",
    to: "/announcements",
    icon: Megaphone,
  },
  {
    label: "Notifications",
    to: "/notifications",
    icon: Bell,
  },
];

const NAVIGATION_BY_ROLE = {
  ADMIN: [
    {label:'Dashboard',to:'/dashboard',icon:LayoutDashboard},
    {label:'Employees',to:'/employees',icon:UsersRound,end:false},
    {label:'Organization',to:'/organization',icon:Network},
    {label:'Attendance',to:'/attendance',icon:CalendarDays},
    {label:'Leave Overview',to:'/leaves?view=management',icon:CalendarRange},
    {label:'Payroll',to:'/payroll',icon:WalletCards},
    {label:'Employment Management',to:'/employment',icon:BriefcaseBusiness},
    {label:'Reports',to:'/reports',icon:ChartNoAxesColumnIncreasing},
    {label:'Employee Records',to:'/employee-records',icon:ContactRound},
    {label:'Announcements',to:'/announcements',icon:Megaphone},
    {label:'Attendance Settings',to:'/attendance-settings',icon:Settings2},
    {label:'Global Audit Log',to:'/audit',icon:ScrollText},
    {label:'Account & Security',to:'/my-profile?tab=security',icon:ShieldCheck},
  ],
  HR: MANAGEMENT_NAVIGATION,
  MANAGER: MANAGER_NAVIGATION,
  EMPLOYEE: EMPLOYEE_NAVIGATION,
};

export default function PortalSidebar({ onNavigate }) {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  const homePath = user.mustChangePassword
    ? "/my-profile?tab=security"
    : "/dashboard";

  const navigation = user.role==='ADMIN' ? NAVIGATION_BY_ROLE.ADMIN : [...(NAVIGATION_BY_ROLE[user.role] || []),{label:'Employment',to:'/employment',icon:BriefcaseBusiness},{label:'My Profile',to:'/my-profile',icon:UserRound}];

  // Preserve the existing first-login password-change restriction.
  const visibleItems = user.mustChangePassword
    ? navigation.filter((item) => item.to.split('?')[0] === "/my-profile").map(item => ({ ...item, to: '/my-profile?tab=security' }))
    : navigation;

  return (
    <div className="portal-sidebar relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className="relative z-10 shrink-0 border-b border-sidebar-border px-5 py-5">
        <Link
          to={homePath}
          onClick={() => onNavigate?.()}
          aria-label="AdRankoHRM home"
          className="inline-flex max-w-full items-center gap-2 rounded-sm text-xl font-semibold tracking-tight text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
        >
          <AdRankoLogo />
          <span className="min-w-0">AdRanko<span className="portal-sidebar-brand-accent">HRM</span></span>
        </Link>
      </div>

      <nav
        aria-label="Main navigation"
        className="relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
      >
        <ul className="space-y-0.5">
          {visibleItems.map((item) => {
            const Icon = item.icon;

            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end ?? true}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) =>
                    cn(
                      "portal-sidebar-link relative flex min-h-9.5 min-w-0 items-center gap-3 rounded-lg px-3 py-2",
                      "text-sm transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2",
                      "focus-visible:outline-sidebar-ring",
                      isActive
                        ? "portal-sidebar-link-active font-semibold text-sidebar-primary-foreground"
                        : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )
                  }
                >
                  <Icon
                    className="size-5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />

                  <span className="min-w-0 break-words">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <footer className="portal-sidebar-footer relative z-10 mx-4 flex min-w-0 shrink-0 items-center gap-3 border-t border-sidebar-border pt-4 pb-5">
        <InitialsAvatar name={user.displayName} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs leading-4 text-sidebar-foreground/70">Signed in as</p>
          <p title={user.displayName} className="whitespace-normal text-sm leading-5 font-semibold normal-case text-white [overflow-wrap:anywhere]">{user.displayName}</p>
          <p className="text-xs leading-4 text-sidebar-foreground/70 [overflow-wrap:anywhere]">{ROLE_LABELS[user.role]}</p>
        </div>
      </footer>
    </div>
  );
}

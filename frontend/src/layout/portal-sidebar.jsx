import {
  Bell,
  CalendarCheck,
  Clock,
  FileText,
  LayoutDashboard,
  Megaphone,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Link, NavLink } from "react-router";
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
    icon: UsersRound,
  },
  {
    label: "Attendance",
    to: "/attendance",
    icon: CalendarCheck,
  },
  {
    label: "Leave Management",
    to: "/leaves",
    icon: CalendarCheck,
  },
  {
    label: "Payroll",
    to: "/payroll",
    icon: FileText,
  },
  {
    label: "Reports",
    to: "/reports",
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
  {
    label: "My Payslips",
    to: "/my-payslips",
    icon: FileText,
  },
  {
    label: "Attendance Settings",
    to: "/attendance-settings",
    icon: Clock,
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
    icon: CalendarCheck,
  },
  {
    label: "My Leave",
    to: "/leaves",
    icon: CalendarCheck,
  },
  {
    label: "Reports",
    to: "/reports",
    icon: FileText,
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
    label: "My Organization",
    to: "/my-employees",
    icon: UserRound,
  },
  {
    label: "My Attendance",
    to: "/attendance",
    icon: CalendarCheck,
  },
  {
    label: "My Leave",
    to: "/leaves",
    icon: CalendarCheck,
  },
  {
    label: "My Reports",
    to: "/reports",
    icon: FileText,
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
    {label:'Organization',to:'/organization',icon:UsersRound},
    {label:'Attendance',to:'/attendance',icon:CalendarCheck},
    {label:'Leave Overview',to:'/leaves?view=management',icon:CalendarCheck},
    {label:'Payroll',to:'/payroll',icon:FileText},
    {label:'Employment Management',to:'/employment',icon:UsersRound},
    {label:'Reports',to:'/reports',icon:FileText},
    {label:'Announcements',to:'/announcements',icon:Megaphone},
    {label:'Attendance Settings',to:'/attendance-settings',icon:Clock},
    {label:'Global Audit Log',to:'/audit',icon:FileText},
    {label:'Account & Security',to:'/my-profile?tab=security',icon:UserRound},
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

  const navigation = user.role==='ADMIN' ? NAVIGATION_BY_ROLE.ADMIN : [...(NAVIGATION_BY_ROLE[user.role] || []),{label:'My Profile',to:'/my-profile',icon:UserRound},{label:'Employment',to:'/employment',icon:UsersRound}];

  // Preserve the existing first-login password-change restriction.
  const visibleItems = user.mustChangePassword
    ? navigation.filter((item) => item.to.split('?')[0] === "/my-profile").map(item => ({ ...item, to: '/my-profile?tab=security' }))
    : navigation;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="shrink-0 border-b border-sidebar-border px-6 py-6">
        <Link
          to={homePath}
          onClick={() => onNavigate?.()}
          aria-label="OfficeHR home"
          className="inline-block rounded-sm text-2xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
        >
          Office<span className="text-sidebar-ring">HR</span>
        </Link>
      </div>

      <nav
        aria-label="Main navigation"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
      >
        <ul className="space-y-1.5">
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
                      "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2",
                      "text-sm transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2",
                      "focus-visible:outline-sidebar-ring",
                      isActive
                        ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-2xs"
                        : "font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
                    )
                  }
                >
                  <Icon
                    className="size-5 shrink-0"
                    aria-hidden="true"
                  />

                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <footer className="shrink-0 border-t border-sidebar-border px-6 py-5">
        <p className="text-xs text-sidebar-foreground/70">
          Signed in as
        </p>

        <p
          title={user.displayName}
          className="mt-2 truncate text-sm font-semibold"
        >
          {user.displayName}
        </p>

        <p className="mt-1 text-xs text-sidebar-foreground/80">
          {ROLE_LABELS[user.role]}
        </p>
      </footer>
    </div>
  );
}

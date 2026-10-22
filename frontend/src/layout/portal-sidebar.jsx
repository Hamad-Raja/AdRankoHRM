import {
  LayoutDashboard,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Link, NavLink } from "react-router";

import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

const ALL_ROLES = ["ADMIN", "HR", "MANAGER", "EMPLOYEE"];

const ROLE_LABELS = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

const NAVIGATION = [
  { label: "Organization", to: "/organization", icon: UsersRound, roles: ["ADMIN", "HR"], allowPasswordChange: false, end: true },
  { label: "Employee profiles", to: "/my-employees", icon: UsersRound, roles: ["MANAGER", "EMPLOYEE"], allowPasswordChange: false, end: true },
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
    roles: ALL_ROLES,
    allowPasswordChange: false,
    end: true,
  },
  {
    label: "Employees",
    to: "/employees",
    icon: UsersRound,
    roles: ["ADMIN", "HR"],
    allowPasswordChange: false,
    end: false,
  },
  {
    label: "My account",
    to: "/account",
    icon: UserRound,
    roles: ALL_ROLES,
    allowPasswordChange: true,
    end: true,
  },
];

export default function PortalSidebar({ onNavigate }) {
  const { user } = useAuth();

  const homePath = user.mustChangePassword
    ? "/account"
    : "/dashboard";

  const visibleItems = NAVIGATION.filter(
    (item) =>
      item.roles.includes(user.role) &&
      (!user.mustChangePassword || item.allowPasswordChange)
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-6 py-6">
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
        className="flex-1 overflow-y-auto px-3 py-6"
      >
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;

            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 py-3",
                      "text-sm font-medium",
                      "focus-visible:outline-2 focus-visible:outline-offset-2",
                      "focus-visible:outline-sidebar-ring",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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

      <footer className="border-t border-sidebar-border px-6 py-5">
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

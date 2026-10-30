import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "@/context/auth-context";
import MyShift from '@/components/my-shift';
import AttendanceClock from '@/components/attendance-clock';
import AnnouncementBanner from '@/components/announcement-banner';

const ROLE_LABELS = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

const PAGE_TITLES = {
  ADMIN: "Admin overview",
  HR: "HR overview",
  MANAGER: "Manager overview",
  EMPLOYEE: "My overview",
};

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-primary">
          {ROLE_LABELS[user.role]}
        </p>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {PAGE_TITLES[user.role]}
        </h1>

        <p className="mt-3 text-muted-foreground">
          Welcome back, {user.displayName}.
        </p>
      </div>

      <AnnouncementBanner />
      <AttendanceClock />
      <MyShift />
      <section
        aria-labelledby="account-summary-heading"
        className="max-w-2xl rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <h2 id="account-summary-heading" className="text-lg font-semibold">
          Your OfficeHR account
        </h2>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Email</dt>
            <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
              {user.email}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted-foreground">Account status</dt>
            <dd className="mt-2">
              <span className="rounded-full bg-success px-3 py-1 text-sm font-medium text-success-foreground">
                Active
              </span>
            </dd>
          </div>
        </dl>

        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          Review your account details and manage your password.
        </p>

        <Link
          to="/account"
          className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-2xs hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Manage my account
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}

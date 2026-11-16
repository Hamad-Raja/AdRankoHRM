import { useEffect, lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router";

import PortalLayout from "@/layout/portal-layout";
import { AuthProvider } from "@/context/auth-context";

import AccountPage from "@/pages/account-page";
import DashboardPage from "@/pages/dashboard-page";
import EmployeeCreatePage from "@/pages/employee-create-page";
import EmployeeDetailPage from "@/pages/employee-detail-page";
import OrganizationPage from "@/pages/organization-page";
import AttendanceSettingsPage from "@/pages/attendance-settings-page";
import AttendancePage from "@/pages/attendance-page";
import ReportsPage from "@/pages/reports-page";
import AuditPage from "@/pages/audit-page";
import MyProfilePage from "@/pages/my-profile-page";
import EmploymentPage from "@/pages/employment-page";
const PayrollPage = lazy(() => import("@/pages/payroll-page"));
const AnnouncementsPage = lazy(() => import("@/pages/announcements-page"));
const NotificationsPage = lazy(() => import("@/pages/notifications-page"));
const LeavesPage = lazy(() => import("@/pages/leaves-page"));
import ScopedEmployeesPage from "@/pages/scoped-employees-page";
import EmployeesPage from "@/pages/employees-page";
import LoginPage from "@/pages/login-page";
import NotFoundPage from "@/pages/not-found-page";

import {
  GuestRoute,
  ProtectedRoute,
} from "@/routes/route-guards";

export default function App() {
  useEffect(() => {
    document.title = "AdRankoHRM";
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={<Navigate to="/dashboard" replace />}
          />

          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />

          <Route element={<ProtectedRoute allowPasswordChange />}>
            <Route element={<PortalLayout />}>
              <Route path="/account" element={<AccountPage />} />
              <Route path="/my-profile" element={<MyProfilePage/>}/>

              <Route element={<ProtectedRoute />}>
                <Route
                  path="/dashboard"
                  element={<DashboardPage />}
                />
                <Route path="/employment" element={<EmploymentPage/>}/>
                <Route element={<ProtectedRoute allowedRoles={["ADMIN"]}/>}><Route path="/audit" element={<AuditPage/>}/></Route>

                <Route
                  path="/attendance"
                  element={<AttendancePage />}
                />

                <Route
                  path="/reports"
                  element={<ReportsPage />}
                />
                <Route path="/my-payslips" element={<Suspense fallback={<p role="status">Loading payslips…</p>}><PayrollPage key="own-payslips" own /></Suspense>} />
                <Route path="/announcements" element={<Suspense fallback={<p role="status">Loading announcements…</p>}><AnnouncementsPage /></Suspense>} />
                <Route path="/notifications" element={<Suspense fallback={<p role="status">Loading notifications…</p>}><NotificationsPage /></Suspense>} />
                <Route path="/leaves" element={<Suspense fallback={<p role="status">Loading leave...</p>}><LeavesPage /></Suspense>} />

                <Route
                  element={
                    <ProtectedRoute allowedRoles={["ADMIN", "HR"]} />
                  }
                >
                  <Route
                    path="/employees"
                    element={<EmployeesPage />}
                  >
                    <Route path="new" element={<EmployeeCreatePage />} />
                  </Route>
                  <Route path="/payroll" element={<Suspense fallback={<p role="status">Loading payroll…</p>}><PayrollPage key="payroll-management" /></Suspense>} />

                  <Route
                    path="/employees/:employeeId"
                    element={<EmployeeDetailPage />}
                  />

                  <Route
                    path="/organization"
                    element={<OrganizationPage />}
                  />

                  <Route
                    path="/attendance-settings"
                    element={<AttendanceSettingsPage />}
                  />

                  <Route
                    path="/shifts"
                    element={
                      <Navigate
                        to="/attendance-settings"
                        replace
                      />
                    }
                  />
                </Route>

                <Route
                  element={
                    <ProtectedRoute
                      allowedRoles={["MANAGER", "EMPLOYEE"]}
                    />
                  }
                >
                  <Route
                    path="/my-employees"
                    element={<ScopedEmployeesPage />}
                  />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

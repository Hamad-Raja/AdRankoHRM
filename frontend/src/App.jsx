import { useEffect } from "react";
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
    document.title = "OfficeHR";
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
              <Route
                path="/account"
                element={<AccountPage />}
              />

              <Route element={<ProtectedRoute />}>
                <Route
                  path="/dashboard"
                  element={<DashboardPage />}
                />
                <Route
                  path="/attendance"
                  element={<AttendancePage />}
                />

                <Route
                  element={
                    <ProtectedRoute allowedRoles={["ADMIN", "HR"]} />
                  }
                >
                  <Route
                    path="/employees"
                    element={<EmployeesPage />}
                  />

                  <Route
                    path="/employees/new"
                    element={<EmployeeCreatePage />}
                  />
                  <Route path="/employees/:employeeId" element={<EmployeeDetailPage />} />
                  <Route path="/organization" element={<OrganizationPage />} />
                  <Route path="/attendance-settings" element={<AttendanceSettingsPage />} />
                  <Route path="/shifts" element={<Navigate to="/attendance-settings" replace />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={["MANAGER", "EMPLOYEE"]} />}>
                  <Route path="/my-employees" element={<ScopedEmployeesPage />} />
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

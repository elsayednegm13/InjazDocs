import { Navigate, Outlet, Route, Routes } from "react-router";
import { AppShell } from "@/app/shell";
import { useSession } from "@/app/access";
import { ActivityPage, SettingsPage, UsersPage } from "@/features/admin/AdminPages";
import { ChangePasswordPage, LoginPage } from "@/features/auth/LoginPage";
import { CaseDetailPage, CasesListPage, NewCasePage } from "@/features/cases/CasesPages";
import { CustomerDetailPage, CustomerFormPage, CustomersListPage } from "@/features/customers/CustomersPages";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import {
  BookingDetailPage,
  BookingsListPage,
  ContainersPage,
  NotificationsPage,
  RemindersPage,
  ReportsPage,
  SchedulePage,
} from "@/features/ops/OpsPages";
import { TrackPage } from "@/features/track/TrackPage";

function RequireSession() {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireReady() {
  const session = useSession();
  if (session?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/track/:token" element={<TrackPage />} />
      <Route element={<RequireSession />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<RequireReady />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/export-cases" element={<CasesListPage />} />
          <Route path="/export-cases/new" element={<NewCasePage />} />
          <Route path="/export-cases/:id" element={<CaseDetailPage />} />
          <Route path="/customers" element={<CustomersListPage />} />
          <Route path="/customers/new" element={<CustomerFormPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/bookings" element={<BookingsListPage />} />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/containers" element={<ContainersPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Route>
        </Route>
      </Route>
    </Routes>
  );
}

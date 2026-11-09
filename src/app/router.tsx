import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { AppShell } from "@/app/shell";
import { useSession, useSessionPending } from "@/app/access";
import { SessionLoading } from "@/app/session";
import { RouteErrorBoundary, RouteFallback } from "@/app/route-fallback";
import { ChangePasswordPage, LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";

const ActivityPage = lazy(() => import("@/features/admin/AdminPages").then((m) => ({ default: m.ActivityPage })));
const SettingsPage = lazy(() => import("@/features/admin/AdminPages").then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import("@/features/admin/AdminPages").then((m) => ({ default: m.UsersPage })));
const ProfilePage = lazy(() => import("@/features/auth/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const CaseDetailPage = lazy(() => import("@/features/cases/CaseDetailPage").then((m) => ({ default: m.CaseDetailPage })));
const CasesListPage = lazy(() => import("@/features/cases/CaseListPage").then((m) => ({ default: m.CasesListPage })));
const NewCasePage = lazy(() => import("@/features/cases/NewCasePage").then((m) => ({ default: m.NewCasePage })));
const CustomerDetailPage = lazy(() => import("@/features/customers/CustomerDetailPage").then((m) => ({ default: m.CustomerDetailPage })));
const CustomerFormPage = lazy(() => import("@/features/customers/CustomerFormPage").then((m) => ({ default: m.CustomerFormPage })));
const CustomersListPage = lazy(() => import("@/features/customers/CustomerListPage").then((m) => ({ default: m.CustomersListPage })));
const BookingDetailPage = lazy(() => import("@/features/ops/BookingDetailPage").then((m) => ({ default: m.BookingDetailPage })));
const BookingsListPage = lazy(() => import("@/features/ops/BookingsListPage").then((m) => ({ default: m.BookingsListPage })));
const ContainersPage = lazy(() => import("@/features/ops/ContainersPage").then((m) => ({ default: m.ContainersPage })));
const NotificationsPage = lazy(() => import("@/features/ops/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const RemindersPage = lazy(() => import("@/features/ops/RemindersPage").then((m) => ({ default: m.RemindersPage })));
const ReportsPage = lazy(() => import("@/features/ops/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const SchedulePage = lazy(() => import("@/features/ops/SchedulePage").then((m) => ({ default: m.SchedulePage })));
const TrackPage = lazy(() => import("@/features/track/TrackPage").then((m) => ({ default: m.TrackPage })));
const NewQuotationPage = lazy(() => import("@/features/quotations/QuotationForms").then((m) => ({ default: m.NewQuotationPage })));
const QuotationEditPage = lazy(() => import("@/features/quotations/QuotationForms").then((m) => ({ default: m.QuotationEditPage })));
const QuotationDetailPage = lazy(() => import("@/features/quotations/QuotationDetailPage").then((m) => ({ default: m.QuotationDetailPage })));
const ProformaListPage = lazy(() => import("@/features/trade/ProformaPages").then((m) => ({ default: m.ProformaListPage })));
const ProformaEditorPage = lazy(() => import("@/features/trade/ProformaPages").then((m) => ({ default: m.ProformaEditorPage })));
const QuotationsListPage = lazy(() => import("@/features/quotations/QuotationListPage").then((m) => ({ default: m.QuotationsListPage })));

function RequireSession() {
  const session = useSession();
  const pending = useSessionPending();
  if (pending) return <SessionLoading />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireReady() {
  const session = useSession();
  if (session?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

function LazyPage({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <RouteErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/track/:token" element={<LazyPage><TrackPage /></LazyPage>} />
      <Route element={<RequireSession />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<RequireReady />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/export-cases" element={<LazyPage><CasesListPage /></LazyPage>} />
          <Route path="/export-cases/new" element={<LazyPage><NewCasePage /></LazyPage>} />
          <Route path="/export-cases/:id" element={<LazyPage><CaseDetailPage /></LazyPage>} />
          <Route path="/customers" element={<LazyPage><CustomersListPage /></LazyPage>} />
          <Route path="/customers/new" element={<LazyPage><CustomerFormPage /></LazyPage>} />
          <Route path="/customers/:id" element={<LazyPage><CustomerDetailPage /></LazyPage>} />
          <Route path="/bookings" element={<LazyPage><BookingsListPage /></LazyPage>} />
          <Route path="/bookings/:id" element={<LazyPage><BookingDetailPage /></LazyPage>} />
          <Route path="/quotations" element={<LazyPage><QuotationsListPage /></LazyPage>} />
          <Route path="/proformas" element={<LazyPage><ProformaListPage /></LazyPage>} />
          <Route path="/proformas/new" element={<LazyPage><ProformaEditorPage /></LazyPage>} />
          <Route path="/proformas/:id" element={<LazyPage><ProformaEditorPage /></LazyPage>} />
          <Route path="/quotations/new" element={<LazyPage><NewQuotationPage /></LazyPage>} />
          <Route path="/quotations/:id" element={<LazyPage><QuotationDetailPage /></LazyPage>} />
          <Route path="/quotations/:id/edit" element={<LazyPage><QuotationEditPage /></LazyPage>} />
          <Route path="/schedule" element={<LazyPage><SchedulePage /></LazyPage>} />
          <Route path="/containers" element={<LazyPage><ContainersPage /></LazyPage>} />
          <Route path="/reminders" element={<LazyPage><RemindersPage /></LazyPage>} />
          <Route path="/notifications" element={<LazyPage><NotificationsPage /></LazyPage>} />
          <Route path="/reports" element={<LazyPage><ReportsPage /></LazyPage>} />
          <Route path="/users" element={<LazyPage><UsersPage /></LazyPage>} />
          <Route path="/settings" element={<LazyPage><SettingsPage /></LazyPage>} />
          <Route path="/profile" element={<LazyPage><ProfilePage /></LazyPage>} />
          <Route path="/activity" element={<LazyPage><ActivityPage /></LazyPage>} />
        </Route>
        </Route>
      </Route>
    </Routes>
  );
}

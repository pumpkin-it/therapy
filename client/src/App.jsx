import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import Sidebar from './components/layout/Sidebar';
import UatWatermark from './components/layout/UatWatermark';
import { isUAT } from './lib/env';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Calendar from './pages/Calendar';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Practitioners from './pages/Practitioners';
import FundsManagers from './pages/FundsManagers';
import Locations from './pages/Locations';
import Services from './pages/Services';
import ServiceDetail from './pages/ServiceDetail';
import Invoices from './pages/Invoices';
import Reports from './pages/Reports';
// The report editor pulls in TipTap/ProseMirror — loaded only when someone opens it.
const ReportEditor = lazy(() => import('./pages/ReportEditor'));
const ReportTemplateEditor = lazy(() => import('./pages/ReportTemplateEditor'));
import Settings from './pages/Settings';
import FundingTypeRates from './pages/FundingTypeRates';
import AuditLog from './pages/AuditLog';
import RecurringSeries from './pages/RecurringSeries';
import RecurringSeriesDetail from './pages/RecurringSeriesDetail';
import Templates from './pages/Templates';
import FormBuilder from './pages/FormBuilder';
import SignAgreement from './pages/SignAgreement';
import ReportView from './pages/ReportView';
import ClientPortal from './pages/ClientPortal';

// Pretty, emailable single-appointment link (/appointments/:id) — redirects into the calendar's
// own ?appt= query param, which Calendar.jsx already knows how to open without remounting itself
// (a plain path-param route pointing at the same element would remount Calendar on every open).
function AppointmentRedirect() {
  const { id } = useParams();
  return <Navigate to={`/calendar?appt=${id}`} replace />;
}

// Preserves where an unauthenticated visit was actually headed (e.g. a shared /appointments/:id
// link opened cold) so Login.jsx can send them there instead of always landing on /calendar.
function RedirectToLogin() {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/login?next=${next}`} replace />;
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  // Public signing/report pages — never wrapped in the app sidebar/nav, regardless of login
  // state, since they're meant for clients (and work the same if a practitioner opens them too).
  if (window.location.pathname.startsWith('/sign/')) {
    return (
      <Routes>
        <Route path="/sign/:token" element={<SignAgreement />} />
      </Routes>
    );
  }
  if (window.location.pathname.startsWith('/report/')) {
    return (
      <Routes>
        <Route path="/report/:token" element={<ReportView />} />
      </Routes>
    );
  }
  if (window.location.pathname.startsWith('/portal/')) {
    return (
      <Routes>
        <Route path="/portal/:token" element={<ClientPortal />} />
      </Routes>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<RedirectToLogin />} />
      </Routes>
    );
  }

  const p = user.permissions || {};
  const isAdmin = ['owner', 'admin'].includes(user.role);

  return (
    <div className={`flex h-screen overflow-hidden ${isUAT ? 'bg-purple-50/50' : 'bg-gray-50'}`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Routes>
          {p.calendar && <Route path="/calendar" element={<Calendar />} />}
          {p.calendar && <Route path="/appointments/:id" element={<AppointmentRedirect />} />}
          {p.clients && <Route path="/clients" element={<Clients />} />}
          {p.clients && <Route path="/clients/:id" element={<ClientDetail />} />}
          {isAdmin && <Route path="/report-templates" element={<Navigate to="/templates" state={{ tab: 'reports' }} replace />} />}
          {isAdmin && <Route path="/report-templates/:id" element={<Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading editor…</div>}><ReportTemplateEditor /></Suspense>} />}
          {p.clients && <Route path="/clients/:id/reports/:reportId/write" element={<Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading editor…</div>}><ReportEditor /></Suspense>} />}
          {p.users && <Route path="/practitioners" element={<Practitioners />} />}
          {p.funds_managers && <Route path="/funds-managers" element={<FundsManagers />} />}
          {p.locations && <Route path="/locations" element={<Locations />} />}
          {p.services && <Route path="/services" element={<Services />} />}
          {p.services && <Route path="/services/:id" element={<ServiceDetail />} />}
          {p.calendar && <Route path="/recurring-series" element={<RecurringSeries />} />}
          {p.calendar && <Route path="/recurring-series/:id" element={<RecurringSeriesDetail />} />}
          {p.invoices && <Route path="/invoices" element={<Invoices />} />}
          {p.reports && <Route path="/reports" element={<Reports />} />}
          {(p.settings || isAdmin) && <Route path="/templates" element={<Templates />} />}
          {p.settings && <Route path="/templates/forms/:id" element={<FormBuilder />} />}
          <Route path="/audit-log" element={<AuditLog />} />
          {p.settings && <Route path="/settings" element={<Settings />} />}
          {p.services && <Route path="/funding-types/:id/rates" element={<FundingTypeRates />} />}
          <Route path="*" element={<Navigate to={p.calendar ? '/calendar' : p.clients ? '/clients' : p.invoices ? '/invoices' : '/audit-log'} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <UatWatermark />
      <ConfirmProvider>
        <AuthProvider>
          <SettingsProvider>
            <AuthenticatedApp />
          </SettingsProvider>
        </AuthProvider>
      </ConfirmProvider>
    </BrowserRouter>
  );
}

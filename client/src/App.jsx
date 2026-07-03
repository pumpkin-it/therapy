import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import Sidebar from './components/layout/Sidebar';
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
import Settings from './pages/Settings';
import FundingTypeRates from './pages/FundingTypeRates';
import AuditLog from './pages/AuditLog';
import RecurringSeries from './pages/RecurringSeries';
import RecurringSeriesDetail from './pages/RecurringSeriesDetail';
import Templates from './pages/Templates';
import SignAgreement from './pages/SignAgreement';

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  // Public signing page — never wrapped in the app sidebar/nav, regardless of login state,
  // since it's meant for clients (and works the same if a practitioner opens it too).
  if (window.location.pathname.startsWith('/sign/')) {
    return (
      <Routes>
        <Route path="/sign/:token" element={<SignAgreement />} />
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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const p = user.permissions || {};

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Routes>
          {p.calendar && <Route path="/calendar" element={<Calendar />} />}
          {p.clients && <Route path="/clients" element={<Clients />} />}
          {p.clients && <Route path="/clients/:id" element={<ClientDetail />} />}
          {p.users && <Route path="/practitioners" element={<Practitioners />} />}
          {p.funds_managers && <Route path="/funds-managers" element={<FundsManagers />} />}
          {p.locations && <Route path="/locations" element={<Locations />} />}
          {p.services && <Route path="/services" element={<Services />} />}
          {p.services && <Route path="/services/:id" element={<ServiceDetail />} />}
          {p.calendar && <Route path="/recurring-series" element={<RecurringSeries />} />}
          {p.calendar && <Route path="/recurring-series/:id" element={<RecurringSeriesDetail />} />}
          {p.invoices && <Route path="/invoices" element={<Invoices />} />}
          {p.settings && <Route path="/templates" element={<Templates />} />}
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
      <AuthProvider>
        <SettingsProvider>
          <AuthenticatedApp />
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

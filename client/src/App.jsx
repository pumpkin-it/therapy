import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Calendar from './pages/Calendar';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Practitioners from './pages/Practitioners';
import FundsManagers from './pages/FundsManagers';
import Locations from './pages/Locations';
import Services from './pages/Services';
import Invoices from './pages/Invoices';
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';
import RecurringSeries from './pages/RecurringSeries';
import RecurringSeriesDetail from './pages/RecurringSeriesDetail';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/calendar"      element={<Calendar />} />
            <Route path="/clients"       element={<Clients />} />
            <Route path="/clients/:id"   element={<ClientDetail />} />
            <Route path="/practitioners" element={<Practitioners />} />
            <Route path="/funds-managers" element={<FundsManagers />} />
            <Route path="/locations"      element={<Locations />} />
            <Route path="/services"      element={<Services />} />
            <Route path="/recurring-series"     element={<RecurringSeries />} />
            <Route path="/recurring-series/:id" element={<RecurringSeriesDetail />} />
            <Route path="/invoices"      element={<Invoices />} />
            <Route path="/audit-log"      element={<AuditLog />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="*"              element={<Navigate to="/calendar" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Calendar from './pages/Calendar';
import Clients from './pages/Clients';
import Practitioners from './pages/Practitioners';
import FundsManagers from './pages/FundsManagers';
import Services from './pages/Services';
import Invoices from './pages/Invoices';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/calendar"      element={<Calendar />} />
            <Route path="/clients"       element={<Clients />} />
            <Route path="/practitioners" element={<Practitioners />} />
            <Route path="/funds-managers" element={<FundsManagers />} />
            <Route path="/services"      element={<Services />} />
            <Route path="/invoices"      element={<Invoices />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="*"              element={<Navigate to="/calendar" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

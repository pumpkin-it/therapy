import { NavLink } from 'react-router-dom';
import { CalendarDays, Users, UserCog, Layers, FileText, Settings, Stethoscope, Wallet, MapPin, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

const nav = [
  { to: '/calendar',       label: 'Calendar',       icon: CalendarDays },
  { to: '/clients',        label: 'Clients',        icon: Users },
  { to: '/practitioners',  label: 'Users',          icon: UserCog },
  { to: '/funds-managers', label: 'Funders',         icon: Wallet },
  { to: '/locations',      label: 'Locations',      icon: MapPin },
  { to: '/recurring-series', label: 'Recurring',     icon: RefreshCw },
  { to: '/services',       label: 'Services',       icon: Layers },
  { to: '/invoices',       label: 'Invoices',       icon: FileText },
  { to: '/settings',       label: 'Settings',       icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
          <Stethoscope className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-gray-900 text-sm">Therapy</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

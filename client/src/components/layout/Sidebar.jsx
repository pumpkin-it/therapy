import { NavLink } from 'react-router-dom';
import { CalendarDays, Users, UserCog, Layers, FileText, Settings, Stethoscope, Wallet, MapPin, RefreshCw, ScrollText, LogOut, ClipboardList } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';

const nav = [
  { to: '/calendar',        label: 'Calendar',   icon: CalendarDays, perm: 'calendar' },
  { to: '/clients',         label: 'Clients',    icon: Users,        perm: 'clients' },
  { to: '/practitioners',   label: 'Users',      icon: UserCog,      perm: 'users' },
  { to: '/funds-managers',  label: 'Funders',    icon: Wallet,       perm: 'funds_managers' },
  { to: '/locations',       label: 'Locations',  icon: MapPin,       perm: 'locations' },
  { to: '/recurring-series', label: 'Recurring', icon: RefreshCw,    perm: 'calendar' },
  { to: '/services',        label: 'Services',   icon: Layers,       perm: 'services' },
  { to: '/invoices',        label: 'Invoices',   icon: FileText,     perm: 'invoices' },
  { to: '/report-templates', label: 'Templates',  icon: ClipboardList, perm: 'settings' },
  { to: '/audit-log',       label: 'Audit Log',  icon: ScrollText,   perm: null },
  { to: '/settings',        label: 'Settings',   icon: Settings,     perm: 'settings' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const perms = user?.permissions || {};

  const visibleNav = nav.filter(n => !n.perm || perms[n.perm]);

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
          <Stethoscope className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-gray-900 text-sm">Therapy</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {visibleNav.map(({ to, label, icon: Icon }) => (
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

      {user && (
        <div className="border-t border-gray-100 px-3 py-3 space-y-2">
          <div className="px-2">
            <p className="text-sm font-medium text-gray-900 truncate">{user.first_name} {user.last_name}</p>
            <p className="text-xs text-gray-400 truncate">{user.role}</p>
          </div>
          <button onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}

import { NavLink } from 'react-router-dom';
import { CalendarDays, Users, UserCog, Layers, FileText, Settings, Stethoscope, Wallet, MapPin, RefreshCw, ScrollText, LogOut, ClipboardList, BarChart3 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { isUAT } from '../../lib/env';

const nav = [
  { to: '/calendar',        label: 'Calendar',   icon: CalendarDays, perm: 'calendar' },
  { to: '/clients',         label: 'Clients',    icon: Users,        perm: 'clients' },
  { to: '/practitioners',   label: 'Users',      icon: UserCog,      perm: 'users' },
  { to: '/funds-managers',  label: 'Funders',    icon: Wallet,       perm: 'funds_managers' },
  { to: '/locations',       label: 'Locations',  icon: MapPin,       perm: 'locations' },
  { to: '/recurring-series', label: 'Recurring', icon: RefreshCw,    perm: 'calendar' },
  { to: '/services',        label: 'Services',   icon: Layers,       perm: 'services' },
  { to: '/invoices',        label: 'Invoices',   icon: FileText,     perm: 'invoices' },
  { to: '/reports',         label: 'Reports',    icon: BarChart3,    perm: 'reports' },
  { to: '/templates',        label: 'Templates',  icon: ClipboardList, perm: 'settings' },
  { to: '/audit-log',       label: 'Audit Log',  icon: ScrollText,   perm: null },
  { to: '/settings',        label: 'Settings',   icon: Settings,     perm: 'settings' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const perms = user?.permissions || {};

  const visibleNav = nav.filter(n => !n.perm || perms[n.perm]);

  return (
    <aside className={cn(
      'flex h-screen w-56 flex-col border-r',
      isUAT ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-white'
    )}>
      <div className={cn('flex items-center gap-2.5 border-b px-5 py-4', isUAT ? 'border-purple-100' : 'border-gray-100')}>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', isUAT ? 'bg-purple-600' : 'bg-indigo-600')}>
          <Stethoscope className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-gray-900 text-sm">Therapy</span>
        {isUAT && (
          <span className="ml-auto rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
            UAT
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {visibleNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? isUAT ? 'bg-purple-100 text-purple-700' : 'bg-indigo-50 text-indigo-700'
                : isUAT ? 'text-gray-600 hover:bg-purple-100/60 hover:text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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

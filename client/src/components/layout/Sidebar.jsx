import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Mail, ListTodo, Sparkles, CalendarDays, Users, UserCog, Layers, FileText, Settings, Stethoscope, Wallet, MapPin, RefreshCw, ScrollText, LogOut, ClipboardList, BarChart3, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { isUAT } from '../../lib/env';
import useOverdueReports from '../../lib/useOverdueReports';
import useUnfiledEmailCount from '../../lib/useUnfiledEmailCount';

const nav = [
  { to: '/calendar',        label: 'Calendar',   icon: CalendarDays, perm: 'calendar' },
  { to: '/clients',         label: 'Clients',    icon: Users,        perm: 'clients' },
  { to: '/ask',             label: 'Ask',        icon: Sparkles,     perm: 'ask' },
  { to: '/tasks',           label: 'Tasks',      icon: ListTodo,     perm: 'email' },
  { to: '/email',           label: 'Email',      icon: Mail,         perm: 'email' },
  { to: '/practitioners',   label: 'Users',      icon: UserCog,      perm: 'users' },
  { to: '/funds-managers',  label: 'Funders',    icon: Wallet,       perm: 'funds_managers' },
  { to: '/locations',       label: 'Locations',  icon: MapPin,       perm: 'locations' },
  { to: '/recurring-series', label: 'Recurring', icon: RefreshCw,    perm: 'calendar' },
  { to: '/services',        label: 'Services',   icon: Layers,       perm: 'services' },
  { to: '/invoices',        label: 'Invoices',   icon: FileText,     perm: 'invoices' },
  { to: '/reports',         label: 'Reports',    icon: BarChart3,    perm: 'reports' },
  { to: '/templates',        label: 'Templates',  icon: ClipboardList, perm: 'templates', orRoles: ['owner'] },
  // Owner/admin/finance only — 'audit_log' isn't a real permission key, so only orRoles shows it.
  { to: '/audit-log',       label: 'Audit Log',  icon: ScrollText,   perm: 'audit_log', orRoles: ['owner', 'admin', 'finance'] },
  { to: '/settings',        label: 'Settings',   icon: Settings,     perm: 'settings' },
];

const BADGE = 'ml-auto px-2 py-0.5 text-[11px]';
const BADGE_SMALL = 'absolute right-0.5 top-0.5 min-w-[16px] px-1 py-0.5 text-center text-[9px]';

// The menu can be collapsed to icons only (e.g. with two windows side by side on one screen). The
// choice is remembered in this browser; with none saved, a narrow window starts collapsed.
const COLLAPSE_KEY = 'therapy-sidebar-collapsed';
function initialCollapsed() {
  try { const v = localStorage.getItem(COLLAPSE_KEY); if (v !== null) return v === '1'; } catch { /* storage blocked */ }
  return typeof window !== 'undefined' && window.innerWidth < 1100;
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage blocked */ } return !c; });
  const { user, logout } = useAuth();
  const perms = user?.permissions || {};

  const visibleNav = nav.filter(n => !n.perm || perms[n.perm] || n.orRoles?.includes(user?.role));
  const navigate = useNavigate();
  // Red number on Invoices: report invoices overdue (finance sees them all). Click → that tile.
  const overdue = useOverdueReports(!!perms.invoices && !!perms.clients);
  const overdueCount = overdue?.groups?.length || 0;
  // The Email number is the New (inbox) count: incoming email no one has dealt with yet.
  const unfiledEmails = useUnfiledEmailCount(!!perms.email, '/email/counts', 'new');
  const todoCount = useUnfiledEmailCount(!!perms.email, '/tasks/counts', 'todo');

  return (
    <aside className={cn(
      'flex h-screen shrink-0 flex-col border-r transition-[width] duration-150',
      collapsed ? 'w-14' : 'w-56',
      isUAT ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-white'
    )}>
      <div className={cn('flex items-center gap-2.5 border-b py-4', collapsed ? 'flex-col px-2' : 'px-5', isUAT ? 'border-purple-100' : 'border-gray-100')}>
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', isUAT ? 'bg-purple-600' : 'bg-indigo-600')} title={collapsed ? `Therapy${isUAT ? ' (UAT)' : ''}` : undefined}>
          <Stethoscope className="h-4 w-4 text-white" />
        </div>
        {!collapsed && <span className="font-semibold text-gray-900 text-sm">Therapy</span>}
        {isUAT && !collapsed && (
          <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
            UAT
          </span>
        )}
        <button type="button" onClick={toggle} title={collapsed ? 'Show the menu' : 'Hide the menu'} aria-label={collapsed ? 'Show the menu' : 'Hide the menu'}
          className={cn('rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700', !collapsed && 'ml-auto')}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {visibleNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) => cn(
              'relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              isActive
                ? isUAT ? 'bg-purple-100 text-purple-700' : 'bg-indigo-50 text-indigo-700'
                : isUAT ? 'text-gray-600 hover:bg-purple-100/60 hover:text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
            {to === '/invoices' && overdueCount > 0 && (
              <span role="link" title={`${overdueCount} report invoice${overdueCount === 1 ? '' : 's'} overdue`}
                onClick={e => { e.preventDefault(); navigate('/invoices?tile=overdue_reports'); }}
                className={cn('rounded-full bg-red-600 font-semibold leading-none text-white', collapsed ? BADGE_SMALL : BADGE)}>
                {overdueCount}
              </span>
            )}
            {to === '/tasks' && todoCount > 0 && (
              <span title={`${todoCount} task${todoCount === 1 ? '' : 's'} to do`}
                className={cn('rounded-full bg-red-600 font-semibold leading-none text-white', collapsed ? BADGE_SMALL : BADGE)}>
                {todoCount}
              </span>
            )}
            {to === '/email' && unfiledEmails > 0 && (
              <span title={`${unfiledEmails} new email${unfiledEmails === 1 ? '' : 's'} to deal with`}
                className={cn('rounded-full bg-amber-500 font-semibold leading-none text-white', collapsed ? BADGE_SMALL : BADGE)}>
                {unfiledEmails}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className={cn('border-t border-gray-100 py-3 space-y-2', collapsed ? 'px-2' : 'px-3')}>
          {!collapsed && (
            <div className="px-2">
              <p className="text-sm font-medium text-gray-900 truncate">{user.first_name} {user.last_name}</p>
              <p className="text-xs text-gray-400 truncate">{user.role}</p>
            </div>
          )}
          <button onClick={logout} title={collapsed ? `Sign out (${user.first_name} ${user.last_name})` : undefined}
            className={cn('flex w-full items-center gap-3 rounded-lg py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors', collapsed ? 'justify-center' : 'px-3')}>
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      )}
    </aside>
  );
}

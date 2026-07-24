import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  PlusCircle,
  List,
  TrendingUp,
  BarChart3,
  PiggyBank,
  Wallet,
  Tags,
  Bookmark,
  AlertCircle,
  History,
  Terminal,
  Settings as SettingsIcon,
  MoreHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PwaPrompts } from '@/pwa/PwaPrompts';
import { SyncProgressBanner } from '@/sync/SyncProgressBanner';
import { useAppSettings } from './AppSettingsProvider';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/add', label: 'Add', icon: PlusCircle },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/cashflow', label: 'Cashflow', icon: TrendingUp },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/tags', label: 'Tags', icon: Bookmark },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/review', label: 'Review', icon: AlertCircle },
  { to: '/activity', label: 'Activity', icon: History },
  { to: '/sql', label: 'SQL', icon: Terminal },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

// The first N items get their own tab in the mobile bottom bar; the rest live
// behind the "More" sheet so every route stays reachable on a phone.
const MOBILE_PRIMARY = 5;

export function AppShell() {
  const { onboarded } = useAppSettings();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!onboarded) return <Navigate to="/welcome" replace />;

  const overflowItems = NAV_ITEMS.slice(MOBILE_PRIMARY);
  const moreActive = overflowItems.some((i) => location.pathname.startsWith(i.to));
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="border-b border-slate-800 lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between p-4 lg:flex-col lg:items-start lg:gap-6">
          <div className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-slate-100">
            <img src="/icon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            Copper
          </div>
          <nav className="hidden lg:block lg:w-full">
            <ul className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `nav-link flex items-center gap-2 ${isActive ? 'nav-link-active' : ''}`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </aside>
      {/* pb-24 keeps the last rows clear of the fixed mobile bottom nav; the
          sidebar layout at lg has no bottom bar, so reset to the normal inset. */}
      <main className="flex-1 p-4 pb-24 lg:p-8 lg:pb-8">
        <SyncProgressBanner />
        <Outlet />
      </main>
      <PwaPrompts />

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-800 bg-slate-950 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-700" />
            <div className="grid grid-cols-3 gap-1 p-4">
              {overflowItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 rounded-xl px-3 py-4 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                      isActive ? 'bg-brand-500/15 text-brand-400' : 'text-slate-300 hover:bg-slate-800/60'
                    }`
                  }
                >
                  <item.icon className="h-6 w-6" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="flex items-center justify-around py-2">
          {NAV_ITEMS.slice(0, MOBILE_PRIMARY).map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex min-w-[3.25rem] flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    isActive ? 'text-brand-400' : 'text-slate-400'
                  }`
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-label="More pages"
              className={`flex min-w-[3.25rem] flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                moreActive || moreOpen ? 'text-brand-400' : 'text-slate-400'
              }`}
            >
              <MoreHorizontal className="h-5 w-5" />
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

import { useEffect, useState } from 'react';
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
  Settings as SettingsIcon,
  Keyboard,
  MoreHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PwaPrompts } from '@/pwa/PwaPrompts';
import { SyncSetupScreen } from '@/sync/SyncSetupScreen';
import { SyncPausedBanner } from '@/sync/SyncPausedBanner';
import { useAppSettings } from './AppSettingsProvider';
import { Shortcuts } from './Shortcuts';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const DASHBOARD: NavItem = { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };
const ADD: NavItem = { to: '/add', label: 'Add', icon: PlusCircle };
const TRANSACTIONS: NavItem = { to: '/transactions', label: 'Transactions', icon: List };
const CASHFLOW: NavItem = { to: '/cashflow', label: 'Cashflow', icon: TrendingUp };
const REPORTS: NavItem = { to: '/reports', label: 'Reports', icon: BarChart3 };
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: SettingsIcon };

// Grouped so a first-time visitor can tell what each part of the app is for.
const NAV_GROUPS: { heading: string | null; items: NavItem[] }[] = [
  { heading: null, items: [DASHBOARD, ADD] },
  {
    heading: 'Your money',
    items: [TRANSACTIONS, { to: '/accounts', label: 'Accounts', icon: Wallet }],
  },
  { heading: 'See where it goes', items: [REPORTS, CASHFLOW] },
  {
    heading: 'Plan',
    items: [
      { to: '/budgets', label: 'Budgets', icon: PiggyBank },
      { to: '/tags', label: 'Tags', icon: Bookmark },
    ],
  },
  {
    heading: 'Tidy up',
    items: [
      { to: '/categories', label: 'Categories', icon: Tags },
      { to: '/review', label: 'Review', icon: AlertCircle },
      { to: '/activity', label: 'Activity', icon: History },
    ],
  },
];

// Phones get these as tabs in the bottom bar; everything else is in "More".
const MOBILE_PRIMARY: NavItem[] = [DASHBOARD, ADD, TRANSACTIONS, CASHFLOW, REPORTS];
const MOBILE_MORE = [
  ...NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !MOBILE_PRIMARY.includes(i)) })).filter(
    (g) => g.items.length > 0,
  ),
  { heading: null, items: [SETTINGS] },
];

export function AppShell() {
  const { onboarded } = useAppSettings();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Lets the pre-rendered landing page stay hidden for people who already use
  // Copper on this device (see scripts/prerender.mjs).
  useEffect(() => {
    if (!onboarded) return;
    try {
      localStorage.setItem('copper-returning', '1');
    } catch {
      /* storage blocked — the landing page may flash briefly, nothing worse */
    }
  }, [onboarded]);
  if (!onboarded) return <Navigate to="/welcome" replace />;

  const moreActive = MOBILE_MORE.some((g) => g.items.some((i) => location.pathname.startsWith(i.to)));
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="border-b border-slate-800 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between p-4 lg:h-full lg:flex-col lg:items-start lg:gap-6">
          <div className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-slate-100">
            <img src="/icon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            Copper
          </div>
          <nav className="hidden lg:flex lg:w-full lg:flex-1 lg:flex-col lg:overflow-y-auto">
            <div className="space-y-5">
              {NAV_GROUPS.map((g, gi) => (
                <div key={gi}>
                  {g.heading && (
                    <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {g.heading}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {g.items.map((item) => (
                      <SideLink key={item.to} item={item} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-1 border-t border-slate-800 pt-3">
              <ul className="flex-1">
                <SideLink item={SETTINGS} />
              </ul>
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts"
                className="rounded-lg px-2.5 py-2 text-slate-500 hover:bg-slate-800/70 hover:text-slate-200"
              >
                <Keyboard className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </div>
      </aside>
      {/* pb-24 keeps the last rows clear of the fixed mobile bottom nav; the
          sidebar layout at lg has no bottom bar, so reset to the normal inset. */}
      <main className="flex-1 p-4 pb-24 lg:p-8 lg:pb-8">
        <SyncPausedBanner />
        <SyncSetupScreen />
        <Outlet />
      </main>
      <PwaPrompts />
      <Shortcuts helpOpen={shortcutsOpen} onHelpOpenChange={setShortcutsOpen} />

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-800 bg-slate-950 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-700" />
            <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
              {MOBILE_MORE.map((g, gi) => (
                <div key={gi}>
                  {g.heading && (
                    <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {g.heading}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    {g.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) =>
                          `flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
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
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="flex items-center justify-around py-2">
          {MOBILE_PRIMARY.map((item) => (
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

function SideLink({ item }: { item: NavItem }) {
  return (
    <li>
      <NavLink
        to={item.to}
        className={({ isActive }) => `nav-link flex items-center gap-2 ${isActive ? 'nav-link-active' : ''}`}
      >
        <item.icon className="h-4 w-4" />
        {item.label}
      </NavLink>
    </li>
  );
}

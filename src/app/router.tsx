import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Landing } from './Landing';
import { WelcomeGate } from './WelcomeGate';
import { JoinRoute } from './JoinRoute';
import { Privacy, Terms } from './Legal';
import { ForCouples, FromMonefy } from './Guides';
import { Root } from './Root';
import { pages } from './pages';

// App pages load on demand (see pages.ts). The public pages and the app's
// frame load up front: a first-time visitor sees the landing page at once.
export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        path: '/welcome',
        lazy: () =>
          import('./Welcome').then(({ Welcome }) => ({
            Component: () => (
              <WelcomeGate>
                <Welcome />
              </WelcomeGate>
            ),
          })),
      },
      // Public intro at the root. Landing redirects returning (onboarded) users
      // straight to their dashboard, so only first-time visitors see it.
      { path: '/', element: <Landing /> },
      // Invite link from a partner: remembers the shared book, then routes on.
      { path: '/join/:bookId', element: <JoinRoute /> },
      { path: '/privacy', element: <Privacy /> },
      { path: '/terms', element: <Terms /> },
      { path: '/for-couples', element: <ForCouples /> },
      { path: '/from-monefy', element: <FromMonefy /> },
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', lazy: pages.Dashboard },
          { path: '/add', lazy: pages.QuickEntry },
          { path: '/add/several', lazy: pages.AddSeveral },
          { path: '/transactions', lazy: pages.Transactions },
          { path: '/reports', lazy: pages.Reports },
          { path: '/cashflow', lazy: pages.Cashflow },
          { path: '/sql', lazy: pages.SqlConsole },
          { path: '/accounts', lazy: pages.Accounts },
          { path: '/categories', lazy: pages.Categories },
          { path: '/budgets', lazy: pages.Budgets },
          { path: '/tags', lazy: pages.Tags },
          { path: '/review', lazy: pages.Review },
          { path: '/activity', lazy: pages.Activity },
          { path: '/settings', lazy: pages.Settings },
        ],
      },
    ],
  },
]);

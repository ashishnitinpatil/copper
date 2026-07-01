import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Landing } from './Landing';
import { Dashboard } from './Dashboard';
import { QuickEntry } from './QuickEntry';
import { Transactions } from './Transactions';
import { Reports } from './Reports';
import { Cashflow } from './Cashflow';
import { SqlConsole } from './SqlConsole';
import { Accounts } from './Accounts';
import { Categories } from './Categories';
import { Budgets } from './Budgets';
import { Tags } from './Tags';
import { Review } from './Review';
import { Activity } from './Activity';
import { Settings } from './Settings';
import { Welcome } from './Welcome';
import { WelcomeGate } from './WelcomeGate';

export const router = createBrowserRouter([
  {
    path: '/welcome',
    element: (
      <WelcomeGate>
        <Welcome />
      </WelcomeGate>
    ),
  },
  // Public intro at the root. Landing redirects returning (onboarded) users
  // straight to their dashboard, so only first-time visitors see it.
  { path: '/', element: <Landing /> },
  {
    element: <AppShell />,
    children: [
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/add', element: <QuickEntry /> },
      { path: '/transactions', element: <Transactions /> },
      { path: '/reports', element: <Reports /> },
      { path: '/cashflow', element: <Cashflow /> },
      { path: '/sql', element: <SqlConsole /> },
      { path: '/accounts', element: <Accounts /> },
      { path: '/categories', element: <Categories /> },
      { path: '/budgets', element: <Budgets /> },
      { path: '/tags', element: <Tags /> },
      { path: '/review', element: <Review /> },
      { path: '/activity', element: <Activity /> },
      { path: '/settings', element: <Settings /> },
    ],
  },
]);

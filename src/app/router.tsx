import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './AppShell';
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
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'add', element: <QuickEntry /> },
      { path: 'transactions', element: <Transactions /> },
      { path: 'reports', element: <Reports /> },
      { path: 'cashflow', element: <Cashflow /> },
      { path: 'sql', element: <SqlConsole /> },
      { path: 'accounts', element: <Accounts /> },
      { path: 'categories', element: <Categories /> },
      { path: 'budgets', element: <Budgets /> },
      { path: 'tags', element: <Tags /> },
      { path: 'review', element: <Review /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { DBProvider } from './db/DBProvider';
import { AuthProvider } from './auth/AuthProvider';
import { SyncProvider } from './sync/SyncProvider';
import { AppSettingsProvider } from './app/AppSettingsProvider';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <DBProvider>
        <AppSettingsProvider>
          <SyncProvider>
            <RouterProvider router={router} />
          </SyncProvider>
        </AppSettingsProvider>
      </DBProvider>
    </AuthProvider>
  </React.StrictMode>,
);

import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { DBProvider } from '@/db/DBProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { SyncProvider } from '@/sync/SyncProvider';
import { AppSettingsProvider } from './AppSettingsProvider';

/** Pages that read nothing from the book. */
const PUBLIC_PATHS = new Set(['/', '/privacy', '/terms', '/for-couples', '/from-monefy']);

/**
 * The book and everything built on it. The public pages don't need it, so a
 * first-time visitor sees the landing page at once instead of waiting for the
 * book to open. Once open it stays open, as on a visit to Privacy from Settings.
 */
export function Root() {
  const { pathname } = useLocation();
  const [opened, setOpened] = useState(false);
  const needed = opened || !PUBLIC_PATHS.has(pathname);
  useEffect(() => {
    if (needed) setOpened(true);
  }, [needed]);

  if (!needed) return <Outlet />;
  return (
    <AuthProvider>
      <DBProvider>
        <AppSettingsProvider>
          <SyncProvider>
            <Outlet />
          </SyncProvider>
        </AppSettingsProvider>
      </DBProvider>
    </AuthProvider>
  );
}

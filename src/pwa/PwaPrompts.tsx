import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { promptInstall, useInstall } from './install';

// The browser looks for a new version only when the app is opened fresh. A tab
// or installed window left open for days would never hear of one, so look
// again at most once a day: when the person comes back to it, or while it's in
// use. Updates are rare, and each look is a request to the host.
const UPDATE_CHECK_MS = 24 * 60 * 60_000;

function checkForUpdates(reg: ServiceWorkerRegistration) {
  let lastCheck = Date.now();
  const check = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
    lastCheck = Date.now();
    reg.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', check);
  setInterval(check, UPDATE_CHECK_MS);
}

// "Not now" on the install notice is remembered on this device; Settings →
// Preferences still offers installing.
const INSTALL_DISMISSED_KEY = 'copper-install-dismissed';
const HINT_MS = 8000;

function installDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function PwaPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW: (_url, reg) => reg && checkForUpdates(reg) });

  const { canPrompt } = useInstall();
  const [installHidden, setInstallHidden] = useState(installDismissed);
  const [installHint, setInstallHint] = useState(false);
  const showInstall = canPrompt && !installHidden;
  useEffect(() => {
    if (!installHint) return;
    const t = setTimeout(() => setInstallHint(false), HINT_MS);
    return () => clearTimeout(t);
  }, [installHint]);

  const dismissInstall = () => {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch {
      // Not saved: the notice comes back next time, which is all that's lost.
    }
    setInstallHidden(true);
    setInstallHint(true);
  };

  if (!needRefresh && !offlineReady && !showInstall && !installHint) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-4">
      {needRefresh && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-brand-500/40 bg-slate-900/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <span className="text-slate-200">New version available</span>
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="rounded-md bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-400"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Later
          </button>
        </div>
      )}
      {offlineReady && !needRefresh && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-success/40 bg-slate-900/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <span className="text-slate-200">Ready to work offline</span>
          <button
            type="button"
            onClick={() => setOfflineReady(false)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Dismiss
          </button>
        </div>
      )}
      {showInstall && !needRefresh && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <span className="text-slate-200">Install this app</span>
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="rounded-md bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-400"
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismissInstall}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Not now
          </button>
        </div>
      )}
      {installHint && !needRefresh && (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/95 px-4 py-2 text-sm shadow-lg backdrop-blur"
        >
          <span className="text-slate-200">You can install Copper any time from Settings.</span>
          <Link
            to="/settings#install"
            onClick={() => setInstallHint(false)}
            className="text-xs font-semibold text-brand-300 hover:text-brand-200"
          >
            Open Settings
          </Link>
        </div>
      )}
    </div>
  );
}

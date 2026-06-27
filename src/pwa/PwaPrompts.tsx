import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setInstallEvent(null);
  };

  const showInstall = !installed && !!installEvent;

  if (!needRefresh && !offlineReady && !showInstall) return null;

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
            onClick={handleInstall}
            className="rounded-md bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-400"
          >
            Install
          </button>
          <button
            type="button"
            onClick={() => setInstallEvent(null)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

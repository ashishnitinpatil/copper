import { useEffect } from 'react';

/** Keeps a phone's screen on while `active`, so it doesn't sleep mid-setup. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (stopped) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    request();
    // The browser drops the lock whenever the page is hidden; take it back on return.
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

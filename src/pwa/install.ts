import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The browser offers installing once per page load, often before the app has
// finished opening — so catch it here, at import, and keep it: dismissing the
// notice shouldn't lose the offer that Settings can still use.
let offer: BeforeInstallPromptEvent | null = null;
let installed =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
let snapshot = { canPrompt: false, installed };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { canPrompt: !!offer && !installed, installed };
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    installed = true;
    emit();
  });
}

/** Show the browser's install dialog. True if the person installed. */
export async function promptInstall(): Promise<boolean> {
  if (!offer) return false;
  const shown = offer;
  await shown.prompt();
  const { outcome } = await shown.userChoice;
  // An offer can only be shown once; the browser sends a new one if it may ask again.
  offer = null;
  if (outcome === 'accepted') installed = true;
  emit();
  return outcome === 'accepted';
}

/** Whether Copper can be installed from here, or already runs installed. */
export function useInstall(): { canPrompt: boolean; installed: boolean } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** iPhone and iPad have no install dialog; Safari's Share menu adds it. */
export const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
/** Phones always have a way to add Copper to the home screen; some desktops have none. */
export const isPhone = isIOS || (typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent));

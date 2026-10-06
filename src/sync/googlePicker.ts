// Google Picker integration for joining a partner's *shared book*.
//
// Copper uses the privacy-friendly `drive.file` OAuth scope, which only grants
// access to files the app itself created or the user explicitly picked. A file a
// partner shares with you is invisible to the app until you pick it here — the
// pick is what grants access, and it lasts. (Picking a *folder* does not expose
// the files inside it, which is why sync uses one shared file, not a folder.)
//
// Requires a Google Cloud API key (VITE_GOOGLE_API_KEY) with the Picker API
// enabled, and the project number as an app id (VITE_GOOGLE_APP_ID) so the
// granted access is attributed to this app.

import { BOOK_FILE_NAME } from './bookFile';

const GAPI_LOADER_URL = 'https://apis.google.com/js/api.js';

// `window.google` is declared (accounts-only) in auth/google.ts; the Picker
// module lives at `google.picker` and `gapi` is injected by the loader. Both are
// untyped for us, so reach them through a narrow local cast rather than widening
// the global declaration.
function globals(): { gapi: any; google: any } {
  return window as unknown as { gapi: any; google: any };
}

export function isPickerConfigured(): boolean {
  return !!import.meta.env.VITE_GOOGLE_API_KEY;
}

let pickerLoad: Promise<void> | null = null;

// Load the gapi loader script once, then the 'picker' module. Cached so repeat
// opens are instant.
function loadPicker(): Promise<void> {
  if (pickerLoad) return pickerLoad;
  pickerLoad = new Promise<void>((resolve, reject) => {
    const loadModule = () => {
      globals().gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Could not load the Google Picker.')),
      });
    };
    if (globals().gapi) return loadModule();
    const script = document.createElement('script');
    script.src = GAPI_LOADER_URL;
    script.async = true;
    script.defer = true;
    script.onload = loadModule;
    script.onerror = () => {
      pickerLoad = null;
      reject(new Error('Could not reach Google to open the picker.'));
    };
    document.head.appendChild(script);
  });
  return pickerLoad;
}

export interface PickedFile {
  id: string;
  name: string;
}

// How long to wait for the Picker to signal it loaded before assuming its iframe
// was refused ("docs.google.com refused to connect").
// The Picker fires a 'loaded' action on success, which cancels this — so the
// timer only ever fires when the dialog never rendered, not while the user
// browses. Generous enough to cover a slow load on a poor connection.
const PICKER_LOAD_TIMEOUT_MS = 15_000;

// Thrown when the Picker dialog never loads — almost always because several
// Google accounts are signed in and its iframe was refused. The UI turns this
// into an actionable "use a single-account profile" message.
export class PickerBlockedError extends Error {
  constructor() {
    super('The Google picker could not load.');
    this.name = 'PickerBlockedError';
  }
}

// Open the Picker so the user can pick the partner's shared book. With `fileId`
// (from an invite link) it shows just that file; otherwise it lists books shared
// with the user. Resolves with the pick, or null if they cancel.
export async function pickSharedBook(token: string, fileId?: string): Promise<PickedFile | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  if (!apiKey) throw new Error('The Google picker is not configured (VITE_GOOGLE_API_KEY missing).');
  const appId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

  await loadPicker();
  const picker = globals().google.picker;

  return new Promise<PickedFile | null>((resolve, reject) => {
    // Assume the iframe was refused unless the Picker tells us it loaded.
    let loaded = false;
    const failTimer = setTimeout(() => {
      if (!loaded) reject(new PickerBlockedError());
    }, PICKER_LOAD_TIMEOUT_MS);

    // The Picker library appends its dialog to the end of <body> and moves focus
    // to it, which makes the browser jump-scroll the page to the bottom. Capture
    // the scroll position now and restore it after the dialog mounts so the page
    // underneath the (fixed, full-screen) overlay stays put.
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const restoreScroll = () => window.scrollTo(scrollX, scrollY);

    try {
      const view = new picker.DocsView(picker.ViewId.DOCS).setMode(picker.DocsViewMode.LIST);
      if (fileId) view.setFileIds(fileId);
      else view.setOwnedByMe(false).setQuery(BOOK_FILE_NAME);

      const builder = new picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setTitle('Choose your shared Copper book')
        .addView(view)
        .setCallback((data: any) => {
          const action = data.action;
          if (action === picker.Action.LOADED || action === 'loaded') {
            // Dialog rendered — cancel the "refused to connect" fallback and let
            // the user take as long as they like to browse.
            loaded = true;
            clearTimeout(failTimer);
            restoreScroll();
          } else if (action === picker.Action.PICKED) {
            clearTimeout(failTimer);
            const doc = data.docs?.[0];
            resolve(doc ? { id: doc.id, name: doc.name } : null);
          } else if (action === picker.Action.CANCEL) {
            clearTimeout(failTimer);
            resolve(null);
          }
        });
      if (appId) builder.setAppId(appId);
      builder.build().setVisible(true);
      // The jump happens during the focus/reflow right after setVisible, before
      // the 'loaded' callback fires — undo it on the next frame too.
      requestAnimationFrame(restoreScroll);
    } catch (e) {
      clearTimeout(failTimer);
      reject(e instanceof Error ? e : new Error('Could not open the picker.'));
    }
  });
}

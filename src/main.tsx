import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
// Listen for the browser's install offer from the first moment, before the book opens.
import './pwa/install';

// A page's code is fetched when it's first opened. If a new version went live
// since this tab loaded, the old file is gone: reload once to pick up the new one.
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem('copper-chunk-reload') ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem('copper-chunk-reload', String(Date.now()));
  } catch {
    /* no storage: reload anyway */
  }
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

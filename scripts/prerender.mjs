// Pre-renders the public pages (home, privacy, terms) into static HTML after
// `vite build`, so crawlers and Google's OAuth reviewers — which don't run
// JavaScript — see real content instead of an empty <div id="root">.
//
// The app still boots normally: React replaces the pre-rendered markup on load.
// dist/index.html doubles as the fallback for every app route (/dashboard …),
// so an inline script hides the pre-rendered landing page there, and for
// returning users (who are sent straight to their dashboard).
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const SITE = 'https://copper.ashishnitinpatil.com';
const PAGES = [
  { route: '/', file: 'dist/index.html' },
  { route: '/privacy', file: 'dist/privacy.html' },
  { route: '/terms', file: 'dist/terms.html' },
];

// Runs before first paint. `copper-returning` is set by the app once someone
// has finished onboarding on this device.
const HIDE_SCRIPT = `<script>try{if(location.pathname!=='/'||localStorage.getItem('copper-returning'))document.documentElement.classList.add('spa-route')}catch(e){}</script><style>.spa-route [data-prerendered]{display:none}</style>`;

const template = await readFile('dist/index.html', 'utf8');
if (template.includes('data-prerendered')) throw new Error('dist/index.html is already pre-rendered — run vite build first.');

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch();
try {
  for (const { route, file } of PAGES) {
    // A fresh context each time: no onboarding state, so "/" shows the landing page.
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(`http://localhost:4179${route}`, { waitUntil: 'networkidle' });
    await page.locator('#root h1').first().waitFor();
    const markup = await page.locator('#root').innerHTML();
    const title = await page.title();
    await context.close();

    let html = template
      .replace('<div id="root"></div>', `<div id="root"><div data-prerendered>${markup}</div></div>`)
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
    if (route === '/') {
      html = html.replace('</head>', `${HIDE_SCRIPT}</head>`);
    } else {
      html = html
        .replaceAll(`content="${SITE}/"`, `content="${SITE}${route}"`)
        .replace(`<link rel="canonical" href="${SITE}/"`, `<link rel="canonical" href="${SITE}${route}"`);
    }
    await writeFile(file, html);
    console.log(`prerendered ${route} → ${file} (${Math.round(markup.length / 1024)} KB)`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

// Content-Security-Policy, with hashes of the inline scripts above (theme
// before first paint, landing-page hide) so no 'unsafe-inline' is needed for
// scripts. Only Google's sign-in, Drive and Picker hosts are allowed; the
// database needs 'wasm-unsafe-eval'. Shipped Report-Only first: violations
// show in the console without breaking anything — switch to enforcing once a
// sign-in, Picker and sync run shows none.
const hashes = new Set();
for (const { file } of PAGES) {
  const html = await readFile(file, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=|application\/ld\+json/.test(attrs)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
}
const GOOGLE_FRAMES = 'https://accounts.google.com https://docs.google.com https://drive.google.com https://content.googleapis.com';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].join(' ')} https://accounts.google.com/gsi/client https://apis.google.com`,
  // React's style={…} and the Google widgets set inline styles.
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://*.google.com",
  "font-src 'self'",
  "connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://accounts.google.com",
  `frame-src ${GOOGLE_FRAMES}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
await appendFile('dist/_headers', `\n# Added by scripts/prerender.mjs\n/*\n  Content-Security-Policy-Report-Only: ${csp}\n`);
console.log(`CSP (report-only) with ${hashes.size} inline-script hashes → dist/_headers`);

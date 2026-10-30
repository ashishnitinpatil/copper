// Takes the app screenshots shown on the landing page, from a made-up household
// so no real data is ever in them. Run against the dev server:
//
//   npm run dev          (in another terminal)
//   node scripts/screenshots.mjs
//
// It onboards a fresh browser, imports a generated Monefy CSV (a few months of
// ordinary spending) and saves WebP images to public/screens/.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const BASE = process.env.BASE_URL ?? 'http://localhost:2929';
const OUT = 'public/screens';
const MONTHS = 6;

// Same numbers on every run (the dates follow today, so the book looks current).
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = random(7);
const between = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
const pick = (list) => list[Math.floor(rand() * list.length)];

function bookCsv() {
  const rows = [];
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const add = (d, account, category, amount, note = '') => {
    if (d > today) return;
    rows.push([fmt(d), account, category, amount.toFixed(2), 'USD', amount.toFixed(2), 'USD', note]);
  };
  const transfer = (d, from, to, amount, note) => {
    add(d, from, `To '${to}'`, -amount, note);
    add(d, to, `From '${from}'`, amount, note);
  };

  const start = new Date(today.getFullYear(), today.getMonth() - MONTHS + 1, 1);
  add(start, 'Checking', "Initial balance 'Checking'", 3200);
  add(start, 'Savings', "Initial balance 'Savings'", 8500);
  add(start, 'Cash', "Initial balance 'Cash'", 120);
  add(start, 'Credit card', "Initial balance 'Credit card'", 0);

  for (let m = 0; m < MONTHS; m++) {
    const day = (n) => new Date(start.getFullYear(), start.getMonth() + m, n);
    const month = day(1).toLocaleString('en-US', { month: 'long' });
    add(day(1), 'Checking', 'Salary', 4800, `${month} salary`);
    add(day(2), 'Checking', 'Rent', -1450, 'Rent');
    add(day(6), 'Checking', 'Utility bills', -between(70, 115), 'Electricity');
    add(day(9), 'Checking', 'Utility bills', -55, 'Internet');
    add(day(12), 'Credit card', 'Entertainment', -15.99, 'Streaming');
    add(day(14), 'Credit card', 'Mobile', -25, 'Phone plan');
    add(day(3), 'Credit card', 'Bus / metro', -45, 'Monthly transit pass');
    transfer(day(4), 'Checking', 'Cash', 200, 'ATM');
    transfer(day(25), 'Checking', 'Savings', 400, 'Monthly saving');
    transfer(day(21), 'Checking', 'Credit card', Math.round(between(650, 900)), 'Card payment');
    for (const d of [5, 12, 19, 26]) add(day(d), 'Credit card', 'Groceries', -between(55, 135), pick(['Weekly shop', 'Weekly shop', 'Farmers market']));
    for (let i = 0; i < 5; i++) add(day(1 + Math.floor(rand() * 28)), 'Credit card', 'Eating out', -between(14, 58), pick(['Lunch', 'Pizza night', 'Dinner out', 'Brunch', 'Takeaway']));
    for (let i = 0; i < 6; i++) add(day(1 + Math.floor(rand() * 28)), 'Cash', 'Drinks & snacks', -between(3, 9), pick(['Coffee', 'Coffee', 'Smoothie', 'Snacks']));
    add(day(1 + Math.floor(rand() * 28)), 'Credit card', 'Clothes', -between(30, 95), pick(['Shoes', 'Jacket', 'T-shirts']));
    add(day(1 + Math.floor(rand() * 28)), 'Credit card', 'Misc. purchases', -between(15, 60), pick(['Home bits', 'Books', 'Kitchen stuff']));
    add(day(16), 'Credit card', 'Entertainment', -between(24, 60), pick(['Movie tickets', 'Bowling', 'Concert']));
    if (m % 2 === 0) add(day(18), 'Credit card', 'Health', -between(15, 40), 'Pharmacy');
    add(day(11), 'Credit card', 'Fuel', -between(35, 55), 'Fuel');
  }
  add(new Date(start.getFullYear(), start.getMonth() + 2, 8), 'Credit card', 'Vacation', -386, 'Weekend away');
  add(new Date(start.getFullYear(), start.getMonth() + 3, 15), 'Checking', 'Salary', 600, 'Quarterly bonus');
  add(new Date(start.getFullYear(), start.getMonth() + 4, 23), 'Credit card', 'Gifts', -72, 'Birthday present');

  rows.sort((a, b) => a[0].split('/').reverse().join('').localeCompare(b[0].split('/').reverse().join('')));
  const header = 'date,account,category,amount,currency,converted amount,currency,description';
  return [header, ...rows.map((r) => r.map((c) => (/[,"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))].join('\n');
}

async function onboard(page) {
  await page.goto(`${BASE}/welcome`);
  const local = page.getByRole('button', { name: 'Continue without an account' });
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await local.or(next).first().waitFor();
  if (await local.isVisible()) await local.click();
  await next.waitFor();
  await page.getByLabel('Default currency', { exact: true }).click();
  await page.locator('input:focus').fill('USD');
  await page.locator('input:focus').press('Enter');
  await next.click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.waitForSelector('nav');
}

async function importBook(page) {
  await page.goto(`${BASE}/settings#data`);
  await page.getByRole('button', { name: 'Import Monefy CSV' }).click();
  await page
    .locator('input[type="file"][accept*="csv"]')
    .setInputFiles({ name: 'household.csv', mimeType: 'text/csv', buffer: Buffer.from(bookCsv()) });
  await page.getByLabel('Import from Monefy').getByRole('button', { name: 'Replace and import', exact: true }).click();
  await page.getByText(/Imported .*transactions/).waitFor({ timeout: 60_000 });
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`);
  await page.locator('main').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
}

/** Saves what's on screen now as WebP. */
async function shoot(page, name) {
  const png = await page.screenshot();
  await sharp(png).webp({ quality: 82 }).toFile(`${OUT}/${name}.webp`);
  console.log(`saved ${OUT}/${name}.webp`);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  await onboard(page);
  await importBook(page);
  await open(page, '/dashboard');
  // A new book's getting-started checklist and its back-up reminder aren't what
  // the app looks like in use.
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await shoot(page, 'dashboard');
  await open(page, '/reports');
  await shoot(page, 'reports');
  await open(page, '/transactions');
  await shoot(page, 'transactions');

  // The same book on a phone (same origin, so the same data): an expense being
  // added, at the moment its category is chosen.
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await open(phone, '/add');
  for (const key of ['1', '8', '.', '5']) await phone.getByRole('button', { name: key, exact: true }).click();
  await phone.getByLabel('Note', { exact: true }).fill('Lunch');
  await phone.getByRole('button', { name: 'Choose category' }).click();
  await phone.mouse.move(0, 0);
  await phone.waitForTimeout(600);
  await shoot(phone, 'add-phone');
} finally {
  await browser.close();
}

import type { DB } from '../wasm';

export const SETTINGS_KEYS = {
  DUP_SCAN_WINDOW_DAYS: 'dup_scan_window_days',
  ONBOARDED: 'onboarded',
  DEFAULT_CURRENCY: 'default_currency',
  FX_RATES: 'fx_rates',
} as const;

export const SETTINGS_DEFAULTS = {
  [SETTINGS_KEYS.DUP_SCAN_WINDOW_DAYS]: '30',
} as const;

export async function getSetting(db: DB, key: string): Promise<string | null> {
  const rows = await db.execO<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function getSettingNumber(db: DB, key: string, fallback: number): Promise<number> {
  const v = await getSetting(db, key);
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function setSetting(db: DB, key: string, value: string): Promise<void> {
  await db.exec(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

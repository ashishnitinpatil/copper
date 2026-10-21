import type { DB } from '../wasm';
import { uuid } from '../uuid';
import { nowIso } from '@/lib/dates';

export interface CustomTheme {
  id: string;
  name: string;
  background: string;
  accent: string;
  created_at: string;
}

export function listThemes(db: DB): Promise<CustomTheme[]> {
  return db.execO<CustomTheme>('SELECT * FROM themes ORDER BY created_at, name');
}

/** Adds a theme, or updates it when `id` is given. Returns its id. */
export async function saveTheme(
  db: DB,
  theme: { id?: string; name: string; background: string; accent: string },
): Promise<string> {
  if (theme.id) {
    await db.exec('UPDATE themes SET name = ?, background = ?, accent = ? WHERE id = ?', [
      theme.name, theme.background, theme.accent, theme.id,
    ]);
    return theme.id;
  }
  const id = uuid();
  await db.exec('INSERT INTO themes (id, name, background, accent, created_at) VALUES (?, ?, ?, ?, ?)', [
    id, theme.name, theme.background, theme.accent, nowIso(),
  ]);
  return id;
}

export async function deleteTheme(db: DB, id: string): Promise<void> {
  await db.exec('DELETE FROM themes WHERE id = ?', [id]);
}

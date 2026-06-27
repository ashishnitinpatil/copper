import initWasm, { type DB, type SQLite3 } from '@vlcn.io/crsqlite-wasm';
import wasmUrl from '@vlcn.io/crsqlite-wasm/crsqlite.wasm?url';

let sqlite3: SQLite3 | null = null;

export async function getSQLite(): Promise<SQLite3> {
  if (sqlite3) return sqlite3;
  sqlite3 = await initWasm(() => wasmUrl);
  return sqlite3;
}

export type { DB };

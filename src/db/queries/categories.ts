import type { DB } from '../wasm';
import type { Category, CategoryKind } from '../types';
import { uuid } from '../uuid';
import { nowIso } from '@/lib/dates';
import { logCreate, logUpdate, snapshotEntity } from '../changeLog';

export interface CategoryInput {
  parent_id?: string | null;
  name: string;
  kind: CategoryKind;
  icon?: string | null;
  color?: string | null;
  sort_order?: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export async function listCategories(db: DB, includeArchived = false): Promise<Category[]> {
  const sql = includeArchived
    ? 'SELECT * FROM categories ORDER BY sort_order, name'
    : 'SELECT * FROM categories WHERE archived_at IS NULL ORDER BY sort_order, name';
  return db.execO<Category>(sql);
}

/** How many entries each category has had since `since` (YYYY-MM-DD). */
export async function categoryUsage(db: DB, since: string): Promise<Map<string, number>> {
  const rows = await db.execA<[string, number]>(
    `SELECT category_id, count(*) FROM transactions
     WHERE category_id IS NOT NULL AND occurred_on >= ?
     GROUP BY category_id`,
    [since],
  );
  return new Map(rows);
}

/**
 * The categories of the latest entries someone added by hand, newest first.
 * Entries added for them (recurring, loan payments, card plan interest) don't
 * count: they'd put "Loan interest" first every morning.
 */
export async function recentCategories(db: DB, since: string): Promise<string[]> {
  // Dated since `since` (the last few months), so the date index keeps it
  // quick on a big book; the "+"s keep SQLite on that index.
  const rows = await db.execA<[string]>(
    `SELECT category_id FROM transactions
     WHERE occurred_on >= ? AND +category_id IS NOT NULL AND +recurring_id IS NULL AND +payment_of IS NULL
       AND id NOT LIKE 'plan:%'
     ORDER BY created_at DESC, occurred_on DESC LIMIT 50`,
    [since],
  );
  return rows.map(([id]) => id);
}

export function getDescendantIds(categories: Category[], id: string): Set<string> {
  const childrenBy = new Map<string, string[]>();
  for (const c of categories) {
    if (c.parent_id) {
      const arr = childrenBy.get(c.parent_id) ?? [];
      arr.push(c.id);
      childrenBy.set(c.parent_id, arr);
    }
  }
  const result = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const curr = stack.pop()!;
    for (const childId of childrenBy.get(curr) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

export function buildCategoryPath(categories: Category[], id: string): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  let curr: Category | undefined = byId.get(id);
  let safety = 0;
  while (curr && safety++ < 64) {
    parts.unshift(curr.name);
    curr = curr.parent_id ? byId.get(curr.parent_id) : undefined;
  }
  return parts.join(' › ');
}

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const c of categories) {
    byId.set(c.id, { ...c, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function createCategory(db: DB, input: CategoryInput): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await db.exec(
    `INSERT INTO categories (id, parent_id, name, kind, icon, color, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.parent_id ?? null,
      input.name,
      input.kind,
      input.icon ?? null,
      input.color ?? null,
      input.sort_order ?? 0,
      now,
    ],
  );
  await logCreate(db, 'category', id);
  return id;
}

export async function updateCategory(db: DB, id: string, input: CategoryInput): Promise<void> {
  const before = await snapshotEntity(db, 'category', id);
  await db.exec(
    `UPDATE categories SET parent_id = ?, name = ?, kind = ?, icon = ?, color = ?, sort_order = ?
     WHERE id = ?`,
    [
      input.parent_id ?? null,
      input.name,
      input.kind,
      input.icon ?? null,
      input.color ?? null,
      input.sort_order ?? 0,
      id,
    ],
  );
  await logUpdate(db, 'category', id, before);
}

export async function archiveCategory(db: DB, id: string): Promise<void> {
  const before = await snapshotEntity(db, 'category', id);
  await db.exec('UPDATE categories SET archived_at = ? WHERE id = ?', [nowIso(), id]);
  await logUpdate(db, 'category', id, before);
}

/** Every category named with what it's under ("Food › Snacks"), A–Z by that, so each sits below its parent. */
export function categoryPaths<T extends Category>(categories: T[]): (T & { path: string })[] {
  return categories
    .map((c) => ({ ...c, path: buildCategoryPath(categories, c.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

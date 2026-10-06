import { useCallback, useMemo, useState } from 'react';
import { PageShell } from './PageShell';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useDB, useSiteId } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  listActivity,
  listEntityHistory,
  countActivity,
  clearActivity,
  type ActivityEntry,
} from '@/db/changeLog';
import type { ChangeDiff, ChangeEntity, ChangeOp } from '@/db/types';

const ENTITY_LABEL: Record<ChangeEntity, string> = {
  transaction: 'Transaction',
  account: 'Account',
  category: 'Category',
  tag: 'Tag',
  budget: 'Budget',
  recurring: 'Recurring rule',
};

const OP_VERB: Record<ChangeOp, string> = {
  insert: 'Added',
  update: 'Edited',
  delete: 'Deleted',
};

// Op marker tone — themed status tokens so they hold up on light themes too.
const OP_TONE: Record<ChangeOp, string> = {
  insert: 'bg-success/15 text-success ring-success/30',
  update: 'bg-info/15 text-info ring-info/30',
  delete: 'bg-danger/15 text-danger ring-danger/30',
};

const SOURCE_LABEL: Record<string, string> = {
  'monefy-import': 'Imported from Monefy',
  'bulk-delete': 'Deleted in bulk',
  'bulk-category': 'Recategorised in bulk',
  transfer: 'Transfer',
  tags: 'Tag change',
  'category-merge': 'Merged categories',
  'account-merge': 'Merged accounts',
};

function parseDiff(raw: string): ChangeDiff | null {
  try {
    return JSON.parse(raw) as ChangeDiff;
  } catch {
    return null;
  }
}

/** A short, human label for one record. */
function describeEntry(entry: ActivityEntry): string {
  const base = ENTITY_LABEL[entry.entity];
  // Prefer the record's live name/note (resolved at query time) — it reflects
  // the current state and covers edits that didn't touch the name field.
  const live = entry.entity_name ?? (entry.entity === 'transaction' ? entry.entity_note : null);
  if (typeof live === 'string' && live.trim()) return `${base} · ${live.trim()}`;

  // The record is gone (deleted) or never had a name — fall back to the snapshot
  // captured in the diff, so even deleted records stay identifiable.
  const diff = parseDiff(entry.diff);
  if (diff && 'changes' in diff) {
    const renamed = diff.changes.name?.new;
    return typeof renamed === 'string' && renamed ? `${base} · ${renamed}` : base;
  }
  const snap = diff && 'after' in diff ? diff.after : diff && 'before' in diff ? diff.before : null;
  if (!snap) return base;
  const fromSnap = entry.entity === 'transaction' ? snap.note : snap.name;
  return typeof fromSnap === 'string' && fromSnap.trim() ? `${base} · ${fromSnap.trim()}` : base;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface Group {
  key: string;
  batchId: string | null;
  entries: ActivityEntry[];
}

/** Collapse rows sharing a batch id into one group, preserving first-seen order. */
function groupEntries(entries: ActivityEntry[]): Group[] {
  const groups: Group[] = [];
  const byBatch = new Map<string, Group>();
  for (const e of entries) {
    if (e.batch_id) {
      const existing = byBatch.get(e.batch_id);
      if (existing) {
        existing.entries.push(e);
        continue;
      }
      const g: Group = { key: `b:${e.batch_id}`, batchId: e.batch_id, entries: [e] };
      byBatch.set(e.batch_id, g);
      groups.push(g);
    } else {
      groups.push({ key: `e:${e.id}`, batchId: null, entries: [e] });
    }
  }
  return groups;
}

const PAGE_SIZE = 200;

export function Activity() {
  const db = useDB();
  const localSiteId = useSiteId();
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const state = useQuery<{ entries: ActivityEntry[]; total: number }>(
    useCallback(
      (d) =>
        Promise.all([listActivity(d, limit), countActivity(d)]).then(([entries, total]) => ({
          entries,
          total,
        })),
      [limit],
    ),
    // 'devices' too, so renaming a device re-labels its rows without a reload.
    { deps: ['change_log', 'devices'] },
  );
  const entries = state.data?.entries ?? [];
  const total = state.data?.total ?? 0;
  const groups = useMemo(() => groupEntries(entries), [entries]);

  const doClear = async () => {
    setClearing(true);
    try {
      await clearActivity(db);
      setClearOpen(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <PageShell
      title="Activity"
      subtitle="Every change to your data — who made it, when, and exactly what moved"
      actions={
        entries.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setClearOpen(true)}>
            Clear log
          </Button>
        ) : null
      }
    >
      <Card>
        {state.loading && entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : groups.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Changes you make — adding a transaction, editing an account — will show up here, attributed to the device that made them."
          />
        ) : (
          <>
            <ol className="space-y-1">
              {groups.map((g) =>
                g.batchId ? (
                  <GroupRow key={g.key} group={g} localSiteId={localSiteId} />
                ) : (
                  <EntryRow key={g.key} entry={g.entries[0]} localSiteId={localSiteId} />
                ),
              )}
            </ol>
            <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-500">
              <span>
                Showing {entries.length.toLocaleString()} of {total.toLocaleString()} changes
              </span>
              {entries.length < total && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                  disabled={state.loading}
                >
                  {state.loading ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <Modal open={clearOpen} onClose={() => !clearing && setClearOpen(false)} title="Clear activity log">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            This permanently removes the entire change history. Your accounts, transactions and other
            data are <span className="font-medium text-slate-100">not</span> affected — only the audit
            trail is erased. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearOpen(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doClear} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Clear log'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}

/**
 * The change history of a single record, newest first. Reuses the feed's row
 * rendering so a transaction's timeline looks identical to the global Activity
 * page. Drop it into any edit view: `<EntityHistory entity="transaction" .../>`.
 */
export function EntityHistory({ entity, entityId }: { entity: ChangeEntity; entityId: string }) {
  const localSiteId = useSiteId();
  const state = useQuery<ActivityEntry[]>(
    useCallback((d) => listEntityHistory(d, entity, entityId), [entity, entityId]),
    { deps: ['change_log', 'devices'] },
  );
  const entries = state.data ?? [];

  if (state.loading && entries.length === 0) {
    return <p className="text-xs text-slate-500">Loading history…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No recorded history yet — changes are logged from here on.
      </p>
    );
  }
  return (
    <ol className="space-y-1">
      {entries.map((e) => (
        <EntryRow key={e.id} entry={e} localSiteId={localSiteId} />
      ))}
    </ol>
  );
}

function Marker({ op }: { op: ChangeOp }) {
  return (
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ${OP_TONE[op]}`}
      aria-hidden
    >
      {op === 'insert' ? '+' : op === 'delete' ? '−' : '✎'}
    </span>
  );
}

function DeviceTime({ entry, localSiteId }: { entry: ActivityEntry; localSiteId: string }) {
  const isLocal = entry.site_id === localSiteId;
  const name = entry.device_name ?? `Device-${entry.site_id.slice(0, 4).toUpperCase()}`;
  return (
    <div className="mt-0.5 text-xs text-slate-500">
      <span className={isLocal ? 'text-slate-400' : ''}>{name}</span>
      {isLocal && <span className="text-slate-600"> (this device)</span>}
      <span className="mx-1.5 text-slate-700">·</span>
      {timeLabel(entry.at)}
    </div>
  );
}

function EntryRow({ entry, localSiteId }: { entry: ActivityEntry; localSiteId: string }) {
  return (
    <li className="rounded-lg px-2 py-2 hover:bg-slate-900/50">
      <div className="flex gap-3">
        <Marker op={entry.op} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-200">
            <span className="font-medium">{OP_VERB[entry.op]}</span>{' '}
            <span className="text-slate-400">{describeEntry(entry)}</span>
          </div>
          <DeviceTime entry={entry} localSiteId={localSiteId} />
          <DiffDetail entry={entry} />
        </div>
      </div>
    </li>
  );
}

function groupTitle(group: Group): string {
  const source = group.entries[0]?.source ?? null;
  const label = source ? (SOURCE_LABEL[source] ?? source) : 'Bulk change';
  if (source === 'transfer') return label;
  return `${label} · ${group.entries.length} records`;
}

function GroupRow({ group, localSiteId }: { group: Group; localSiteId: string }) {
  const head = group.entries[0];
  return (
    <li className="rounded-lg px-2 py-2 hover:bg-slate-900/50">
      <details>
        <summary className="flex cursor-pointer list-none items-start gap-3">
          <Marker op={head.op} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-200">{groupTitle(group)}</div>
            <DeviceTime entry={head} localSiteId={localSiteId} />
          </div>
          <span className="mt-1 text-xs text-slate-500">Show</span>
        </summary>
        <ol className="mt-2 space-y-1 border-l border-slate-800 pl-4">
          {group.entries.slice(0, 200).map((e) => (
            <li key={e.id} className="py-1">
              <div className="text-xs text-slate-300">
                {OP_VERB[e.op]} <span className="text-slate-500">{describeEntry(e)}</span>
              </div>
              <DiffDetail entry={e} compact />
            </li>
          ))}
          {group.entries.length > 200 && (
            <li className="py-1 text-xs text-slate-600">
              …and {group.entries.length - 200} more (showing the first 200)
            </li>
          )}
        </ol>
      </details>
    </li>
  );
}

function DiffDetail({ entry, compact = false }: { entry: ActivityEntry; compact?: boolean }) {
  const diff = parseDiff(entry.diff);
  if (!diff) return null;

  let rows: { field: string; old?: unknown; new?: unknown; value?: unknown }[] = [];
  if ('changes' in diff) {
    rows = Object.entries(diff.changes).map(([field, v]) => ({ field, old: v.old, new: v.new }));
  } else {
    const snap = 'after' in diff ? diff.after : diff.before;
    rows = Object.entries(snap).map(([field, value]) => ({ field, value }));
  }
  if (rows.length === 0) return null;

  const isChange = 'changes' in diff;

  return (
    <details className={compact ? 'mt-0.5' : 'mt-1'}>
      <summary className="cursor-pointer list-none text-xs text-slate-600 hover:text-slate-400">
        {isChange ? `${rows.length} field${rows.length === 1 ? '' : 's'} changed` : 'Details'}
      </summary>
      <table className="mt-1 w-full max-w-xl text-left text-xs tabular-nums">
        <tbody>
          {rows.map((r) => (
            <tr key={r.field} className="align-top">
              <td className="py-0.5 pr-3 font-mono text-slate-500">{r.field}</td>
              {isChange ? (
                <td className="py-0.5 font-mono break-all">
                  <span className="text-danger/80">{fmtValue(r.old)}</span>
                  <span className="mx-1 text-slate-600">→</span>
                  <span className="text-success/90">{fmtValue(r.new)}</span>
                </td>
              ) : (
                <td className="py-0.5 font-mono break-all text-slate-400">{fmtValue(r.value)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

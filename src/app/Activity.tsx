import { useCallback, useMemo, useState } from 'react';
import { PageShell } from './PageShell';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useDB, useSiteId } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  listActivityGroups,
  listEntityHistory,
  clearActivity,
  defaultDeviceName,
  type ActivityEntry,
  type ActivityGroup,
} from '@/db/changeLog';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listTags } from '@/db/queries/tags';
import type { ChangeEntity } from '@/db/types';
import { useAppSettings } from './AppSettingsProvider';
import {
  describeEntry,
  describeGroup,
  plural,
  type Description,
  type Lookups,
} from '@/features/activity/describe';
import { toDateString } from '@/lib/dates';
import { isRestorable, restoreDeleted } from '@/features/undo/restoreDeleted';

const PAGE_SIZE = 100;

// Sources whose rows are worth listing under the summary line. An import's
// thousands of rows and a transfer's two legs are fully said by the summary.
const EXPANDABLE = new Set(['bulk-delete', 'bulk-category', 'tags', 'category-merge', 'account-merge']);

/** Names for ids in the log — archived records included, so old entries still read right. */
function useLookups(): Lookups | null {
  const { defaultCurrency } = useAppSettings();
  const state = useQuery(
    useCallback(
      (d) => Promise.all([listAccounts(d, true), listCategories(d, true), listTags(d, true)]),
      [],
    ),
    { deps: ['accounts', 'categories', 'tags'] },
  );
  return useMemo(() => {
    if (!state.data) return null;
    const [accounts, categories, tags] = state.data;
    return {
      accounts: new Map(accounts.map((a) => [a.id, { name: a.name, currency: a.currency }])),
      categories: new Map(categories.map((c) => [c.id, c.name])),
      tags: new Map(tags.map((t) => [t.id, t.name])),
      defaultCurrency,
    };
  }, [state.data, defaultCurrency]);
}

interface Who {
  site_id: string;
  device_name: string | null;
  device_person: string | null;
}

/**
 * "You" for changes from this device or from another device signed in as the
 * same person; otherwise their first name, falling back to the device's name
 * for devices that haven't recorded who uses them.
 */
function useActor() {
  const localSiteId = useSiteId();
  const state = useQuery(
    useCallback(
      (d) =>
        d
          .execO<{ person: string }>('SELECT person FROM devices WHERE site_id = ?', [d.siteid])
          .then((r) => r[0]?.person ?? ''),
      [],
    ),
    { deps: ['devices'] },
  );
  const me = state.data ?? '';
  return useCallback(
    (w: Who) => {
      if (w.site_id === localSiteId || (me && w.device_person === me)) return 'You';
      return w.device_person || w.device_name || defaultDeviceName(w.site_id);
    },
    [localSiteId, me],
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const day = toDateString(d);
  const today = new Date();
  if (day === toDateString(today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day === toDateString(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function Activity() {
  const db = useDB();
  const lookups = useLookups();
  const actor = useActor();
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const state = useQuery(
    useCallback((d) => listActivityGroups(d, limit), [limit]),
    // 'devices' too, so a rename or a new sign-in re-labels rows without a reload.
    { deps: ['change_log', 'devices'] },
  );
  const groups = useMemo(() => state.data?.groups ?? [], [state.data]);
  const hasMore = state.data?.hasMore ?? false;

  // Deleted entries that are back (restored here, or re-added by undo or sync)
  // stop offering Restore.
  // Keyed by the ids' text so the query only reruns when they change.
  const deletedKey = useMemo(
    () => groups.filter(isRestorable).flatMap((g) => g.entries.map((e) => e.entity_id)).join(','),
    [groups],
  );
  const backState = useQuery(
    useCallback(
      async (d) => {
        const deletedIds = deletedKey ? deletedKey.split(',') : [];
        if (deletedIds.length === 0) return new Set<string>();
        const found = new Set<string>();
        for (let i = 0; i < deletedIds.length; i += 500) {
          const chunk = deletedIds.slice(i, i + 500);
          const rows = await d.execO<{ id: string }>(
            `SELECT id FROM transactions WHERE id IN (${chunk.map(() => '?').join(',')})`,
            chunk,
          );
          rows.forEach((r) => found.add(r.id));
        }
        return found;
      },
      [deletedKey],
    ),
    { deps: ['transactions'] },
  );
  const canRestore = (g: ActivityGroup) =>
    isRestorable(g) && !!backState.data && !g.entries.every((e) => backState.data!.has(e.entity_id));

  // Device names only help when changes come from more than one device.
  const showDevice = useMemo(() => new Set(groups.map((g) => g.site_id)).size > 1, [groups]);

  const days = useMemo(() => {
    const out: { label: string; groups: ActivityGroup[] }[] = [];
    for (const g of groups) {
      const label = dayLabel(g.at);
      if (out[out.length - 1]?.label !== label) out.push({ label, groups: [] });
      out[out.length - 1].groups.push(g);
    }
    return out;
  }, [groups]);

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
      subtitle="Who added, changed or deleted what, newest first"
      actions={
        groups.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setClearOpen(true)}>
            Clear history
          </Button>
        ) : null
      }
    >
      {(state.loading && groups.length === 0) || !lookups ? (
        <Card>
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="When you or anyone sharing this book adds, edits or deletes something, it shows up here."
        />
      ) : (
        <>
          {days.map((day) => (
            <section key={day.label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {day.label}
              </h2>
              <Card className="p-2 sm:p-3">
                <ol className="divide-y divide-slate-800/70">
                  {day.groups.map((g) => (
                    <GroupRow
                      key={g.key}
                      group={g}
                      lookups={lookups}
                      who={actor(g)}
                      showDevice={showDevice}
                      restorable={canRestore(g)}
                    />
                  ))}
                </ol>
              </Card>
            </section>
          ))}
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
                disabled={state.loading}
              >
                {state.loading ? 'Loading…' : 'Show older'}
              </Button>
            </div>
          )}
        </>
      )}

      <Modal open={clearOpen} onClose={() => !clearing && setClearOpen(false)} title="Clear history">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            This erases the list of past changes for{' '}
            <span className="font-medium text-slate-100">everyone sharing this book</span>. Your
            accounts and transactions stay exactly as they are. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearOpen(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doClear} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Clear history'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}

/**
 * The change history of a single record, newest first, in the same words as
 * the Activity page. Drop it into any edit view.
 */
export function EntityHistory({ entity, entityId }: { entity: ChangeEntity; entityId: string }) {
  const lookups = useLookups();
  const actor = useActor();
  const state = useQuery<ActivityEntry[]>(
    useCallback((d) => listEntityHistory(d, entity, entityId), [entity, entityId]),
    { deps: ['change_log', 'devices'] },
  );
  const entries = state.data ?? [];

  if ((state.loading && entries.length === 0) || !lookups) {
    return <p className="text-xs text-slate-500">Loading history…</p>;
  }
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">No changes recorded yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li key={e.id}>
          <Sentence who={actor(e)} d={describeEntry(lookups, e)} />
          <p className="mt-0.5 text-xs text-slate-500">
            {dayLabel(e.at)}, {timeLabel(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Avatar({ who }: { who: string }) {
  const you = who === 'You';
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        you ? 'bg-brand-500/15 text-brand-300' : 'bg-info/15 text-info'
      }`}
    >
      {who.charAt(0).toUpperCase()}
    </span>
  );
}

function Sentence({ who, d }: { who: string | null; d: Description }) {
  return (
    <>
      <p className="text-sm text-slate-300">
        {who && <span className="font-medium text-slate-100">{who} </span>}
        {who ? d.text : d.text.charAt(0).toUpperCase() + d.text.slice(1)}
      </p>
      {d.detail && <p className="mt-0.5 truncate text-xs text-slate-500">{d.detail}</p>}
      {d.changes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {d.changes.map((c) => (
            <li key={c.label} className="text-slate-500">
              <span className="text-slate-400">{c.label}:</span>{' '}
              {c.from ? (
                <>
                  <span className="line-through decoration-slate-600">{c.from}</span>
                  <span className="mx-1 text-slate-600">→</span>
                  <span className="text-slate-200">{c.to}</span>
                </>
              ) : (
                <span className="text-slate-200">{c.to}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GroupRow({
  group,
  lookups,
  who,
  showDevice,
  restorable,
}: {
  group: ActivityGroup;
  lookups: Lookups;
  who: string;
  showDevice: boolean;
  restorable: boolean;
}) {
  const db = useDB();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restore = async () => {
    setRestoring(true);
    setRestoreError(null);
    try {
      const res = await restoreDeleted(db, group.key);
      if (!res.ok) setRestoreError(res.reason);
    } finally {
      setRestoring(false);
    }
  };
  const d = group.batch_id ? describeGroup(lookups, group) : describeEntry(lookups, group.entries[0]);
  const expandable = group.batch_id && group.source && EXPANDABLE.has(group.source);
  const hidden = group.total - group.entries.length;
  const localSiteId = useSiteId();
  const device =
    group.site_id === localSiteId ? 'this device' : group.device_name || defaultDeviceName(group.site_id);

  return (
    <li className="flex gap-3 px-1 py-3 sm:px-2">
      <Avatar who={who} />
      <div className="min-w-0 flex-1">
        <Sentence who={who} d={d} />
        <p className="mt-1 text-xs text-slate-600">
          {timeLabel(group.at)}
          {showDevice && device !== who && <> · on {device}</>}
          {restorable && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => void restore()}
                disabled={restoring}
                className="font-medium text-brand-400 hover:underline disabled:opacity-50"
              >
                {restoring ? 'Restoring…' : 'Restore'}
              </button>
            </>
          )}
        </p>
        {restoreError && <p className="mt-1 text-xs text-danger">{restoreError}</p>}
        {expandable && (
          <details className="mt-1.5">
            <summary className="cursor-pointer list-none text-xs text-slate-500 hover:text-slate-300">
              Show the {plural(group.total, 'change')}
            </summary>
            <ol className="mt-2 space-y-2 border-l border-slate-800 pl-3">
              {group.entries.map((e) => (
                <li key={e.id}>
                  <Sentence who={null} d={describeEntry(lookups, e)} />
                </li>
              ))}
              {hidden > 0 && <li className="text-xs text-slate-600">…and {hidden.toLocaleString()} more</li>}
            </ol>
          </details>
        )}
      </div>
    </li>
  );
}

import { useCallback, useState, type ReactNode } from 'react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { InfoHint } from '@/components/ui/InfoHint';
import { Card, EmptyState } from '@/components/ui/Card';
import { Combobox } from '@/components/ui/Combobox';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  listOpenFlags,
  dismissFlag,
  resolveDuplicate,
  runDuplicateScanner,
  runAnomalyScanner,
  type ReviewFlagWithTx,
} from '@/db/queries/reviewFlags';
import {
  findDuplicateAccounts,
  findDuplicateCategories,
  type DuplicateGroup,
  type AccountDupMember,
  type CategoryDupMember,
} from '@/db/queries/duplicates';
import { mergeAccount, mergeCategory } from '@/db/queries/merge';
import { getSettingNumber, SETTINGS_KEYS } from '@/db/queries/settings';
import { formatMoney } from '@/lib/money';
import { useDefaultCurrency } from './AppSettingsProvider';
import { formatHumanDate } from '@/lib/dates';

const REASON_LABEL: Record<string, string> = {
  duplicate: 'Possible duplicate',
  outlier: 'Unusual amount',
  future_dated: 'Future dated',
  stale: 'Old entry',
  empty_category: 'Missing category',
  category_spike: 'Unusually high for category',
};

const REASON_COLOR: Record<string, string> = {
  duplicate: 'bg-warning/20 text-warning',
  outlier: 'bg-purple-500/20 text-purple-300',
  future_dated: 'bg-blue-500/20 text-blue-300',
  empty_category: 'bg-slate-500/20 text-slate-300',
  category_spike: 'bg-danger/20 text-danger',
  stale: 'bg-slate-500/20 text-slate-300',
};

export function Review() {
  const db = useDB();
  const [scanning, setScanning] = useState(false);
  // Session-only "not a duplicate" hides — these suggestions are recomputed
  // live, so there's no persisted dismissal; same-name pairs can be legitimate.
  const [hiddenDups, setHiddenDups] = useState<Set<string>>(new Set());

  const flagsState = useQuery<ReviewFlagWithTx[]>(
    useCallback((d) => listOpenFlags(d), []),
    { deps: ['review_flags', 'transactions'] },
  );

  const accountDupsState = useQuery<DuplicateGroup<AccountDupMember>[]>(
    useCallback((d) => findDuplicateAccounts(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  const categoryDupsState = useQuery<DuplicateGroup<CategoryDupMember>[]>(
    useCallback((d) => findDuplicateCategories(d), []),
    { deps: ['categories', 'transactions'] },
  );

  const flags = flagsState.data ?? [];
  const accountDups = (accountDupsState.data ?? []).filter((g) => !hiddenDups.has(`acct:${g.label}`));
  const categoryDups = (categoryDupsState.data ?? []).filter(
    (g) => !hiddenDups.has(`cat:${g.label}`),
  );

  const hideDup = (key: string) => setHiddenDups((prev) => new Set(prev).add(key));

  const runScan = async () => {
    setScanning(true);
    try {
      const windowDays = await getSettingNumber(db, SETTINGS_KEYS.DUP_SCAN_WINDOW_DAYS, 30);
      await runDuplicateScanner(db, windowDays);
      await runAnomalyScanner(db);
    } finally {
      setScanning(false);
    }
  };

  const handleDismiss = async (id: string) => {
    await dismissFlag(db, id);
  };

  const handleResolveDuplicate = async (flag: ReviewFlagWithTx, keepId: string, deleteId: string) => {
    await resolveDuplicate(db, flag.id, keepId, deleteId);
  };

  const mergeAccounts = async (keepId: string, sourceIds: string[]) => {
    for (const id of sourceIds) await mergeAccount(db, id, keepId);
  };
  const mergeCategories = async (keepId: string, sourceIds: string[]) => {
    for (const id of sourceIds) await mergeCategory(db, id, keepId);
  };

  const nothingToShow =
    flags.length === 0 && accountDups.length === 0 && categoryDups.length === 0;

  return (
    <PageShell
      title="Review"
      subtitle="Possible duplicates and unusual amounts worth a second look"
      actions={
        <Button variant="secondary" onClick={runScan} disabled={scanning}>
          {scanning ? 'Checking…' : 'Run check'}
        </Button>
      }
    >
      {nothingToShow ? (
        <EmptyState
          title="All clear"
          description="Nothing to review. Run a check to look for duplicates or unusual entries."
          action={
            <Button onClick={runScan} disabled={scanning}>
              {scanning ? 'Checking…' : 'Run check'}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {flags.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm text-slate-400">
                {flags.length} transaction{flags.length !== 1 ? 's' : ''} to review
              </div>
              {flags.map((flag) => (
                <FlagCard
                  key={flag.id}
                  flag={flag}
                  onDismiss={() => handleDismiss(flag.id)}
                  onResolveDuplicate={
                    flag.reason === 'duplicate' && flag.related_transaction_id
                      ? (keepFirst: boolean) =>
                          handleResolveDuplicate(
                            flag,
                            keepFirst ? flag.transaction_id : flag.related_transaction_id!,
                            keepFirst ? flag.related_transaction_id! : flag.transaction_id,
                          )
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {accountDups.length > 0 && (
            <DuplicateSection title="Possible duplicate accounts">
              {accountDups.map((group) => (
                <DuplicateGroupCard
                  key={`acct:${group.label}`}
                  noun="account"
                  label={group.label}
                  members={group.members.map((m) => ({
                    id: m.id,
                    name: m.name,
                    sub: `${formatMoney(m.balance_minor, m.currency)} · ${m.tx_count} tx${
                      m.is_main ? ' · main' : ''
                    }`,
                    // Default to keeping the most-used row; the survivor inherits
                    // the "main" flag anyway via mergeAccount.
                    keepPriority: m.tx_count,
                  }))}
                  onMerge={mergeAccounts}
                  onDismiss={() => hideDup(`acct:${group.label}`)}
                />
              ))}
            </DuplicateSection>
          )}

          {categoryDups.length > 0 && (
            <DuplicateSection title="Possible duplicate categories">
              {categoryDups.map((group) => (
                <DuplicateGroupCard
                  key={`cat:${group.label}`}
                  noun="category"
                  label={group.label}
                  members={group.members.map((m) => ({
                    id: m.id,
                    name: m.name,
                    sub: `${m.tx_count} transaction${m.tx_count === 1 ? '' : 's'}`,
                    keepPriority: m.tx_count,
                  }))}
                  onMerge={mergeCategories}
                  onDismiss={() => hideDup(`cat:${group.label}`)}
                />
              ))}
            </DuplicateSection>
          )}
        </div>
      )}
    </PageShell>
  );
}

function DuplicateSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {children}
    </div>
  );
}

interface DupDisplayMember {
  id: string;
  name: string;
  sub: string;
  keepPriority: number;
}

interface DuplicateGroupCardProps {
  noun: string;
  label: string;
  members: DupDisplayMember[];
  onMerge: (keepId: string, sourceIds: string[]) => Promise<void>;
  onDismiss: () => void;
}

function DuplicateGroupCard({ noun, label, members, onMerge, onDismiss }: DuplicateGroupCardProps) {
  const [keepId, setKeepId] = useState(
    () => [...members].sort((a, b) => b.keepPriority - a.keepPriority)[0]?.id ?? '',
  );
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);

  const keptName = members.find((m) => m.id === keepId)?.name ?? '';
  const sourceIds = members.filter((m) => m.id !== keepId).map((m) => m.id);

  const handleMerge = async () => {
    if (!keepId) return;
    setMerging(true);
    try {
      await onMerge(keepId, sourceIds);
    } finally {
      setMerging(false);
    }
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
          {members.length} entries named “{label}”
        </span>
        <InfoHint label="About these suggestions" title="Same-name matches" align="right">
          We flag entries that share a name — they’re often duplicates, but can be
          legitimately separate. “Not duplicates” hides this until the next check;
          it isn’t remembered permanently.
        </InfoHint>
      </div>

      <ul className="space-y-1.5">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 text-sm"
          >
            <span className="text-slate-200">
              {m.id === keepId && <span className="mr-1 text-success">✓</span>}
              {m.name}
            </span>
            <span className="text-xs text-slate-500">{m.sub}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-3">
        <Combobox
          label="Keep this one"
          value={keepId}
          onChange={(v) => {
            setKeepId(v);
            setConfirming(false);
          }}
          options={members.map((m) => ({ value: m.id, label: m.name }))}
        />
        {confirming ? (
          <div className="space-y-2 rounded-md border border-danger/40 bg-danger/10 p-3">
            <p className="text-xs text-danger">
              Merge the other {sourceIds.length} {noun}
              {sourceIds.length === 1 ? '' : 's'} into “{keptName}” and permanently delete{' '}
              {sourceIds.length === 1 ? 'it' : 'them'}? There is no undo.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={merging} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" disabled={merging} onClick={handleMerge}>
                {merging ? 'Merging…' : 'Yes, merge'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Not duplicates
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!keepId || sourceIds.length === 0}
              onClick={() => setConfirming(true)}
            >
              Merge into “{keptName}”
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

interface FlagCardProps {
  flag: ReviewFlagWithTx;
  onDismiss: () => void;
  onResolveDuplicate?: (keepFirst: boolean) => void;
}

function FlagCard({ flag, onDismiss, onResolveDuplicate }: FlagCardProps) {
  const currency = useDefaultCurrency();
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            REASON_COLOR[flag.reason] ?? 'bg-slate-700 text-slate-300'
          }`}
        >
          {REASON_LABEL[flag.reason] ?? flag.reason}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          Confidence: {(flag.score * 100).toFixed(0)}%
          <InfoHint label="What confidence means" title="Just a hint" align="right">
            A rough score for how strongly the entry matched this check — higher
            means more signals lined up. It’s only a prompt to look; the call is
            always yours.
          </InfoHint>
        </span>
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-slate-800/50 p-3">
        <span className="text-lg">{flag.tx_category_icon ?? '•'}</span>
        <div className="flex-1">
          <div className="text-sm text-slate-50">
            {flag.tx_category_name ?? 'Uncategorized'} · {flag.tx_account_name}
          </div>
          <div className="text-xs text-slate-500">
            {formatHumanDate(flag.tx_date)}
            {flag.tx_note ? ` · ${flag.tx_note}` : ''}
          </div>
        </div>
        <div className="text-sm font-semibold tabular-nums text-clay-400">
          {formatMoney(flag.tx_amount, currency)}
        </div>
      </div>

      {flag.reason === 'duplicate' && flag.related_tx_amount != null && (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-3">
          <span className="text-sm text-slate-500">vs</span>
          <div className="flex-1">
            <div className="text-sm text-slate-300">
              {formatHumanDate(flag.related_tx_date!)}
              {flag.related_tx_note ? ` · ${flag.related_tx_note}` : ''}
            </div>
          </div>
          <div className="text-sm tabular-nums text-slate-300">
            {formatMoney(flag.related_tx_amount, currency)}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {onResolveDuplicate && (
          <>
            <Button variant="ghost" size="sm" onClick={() => onResolveDuplicate(true)}>
              Keep this one
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onResolveDuplicate(false)}>
              Keep the other
            </Button>
          </>
        )}
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}

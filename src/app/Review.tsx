import { useCallback, useState } from 'react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
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

  const flagsState = useQuery<ReviewFlagWithTx[]>(
    useCallback((d) => listOpenFlags(d), []),
    { deps: ['review_flags', 'transactions'] },
  );

  const flags = flagsState.data ?? [];

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
      {flags.length === 0 ? (
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
        <div className="space-y-3">
          <div className="text-sm text-slate-400">{flags.length} item{flags.length !== 1 ? 's' : ''} to review</div>
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
    </PageShell>
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
        <span className="text-xs text-slate-500">
          Confidence: {(flag.score * 100).toFixed(0)}%
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

import { useState, useRef } from 'react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { InfoHint } from '@/components/ui/InfoHint';
import { Card } from '@/components/ui/Card';
import { useDB } from '@/db/DBProvider';

const EXAMPLE_QUERIES = [
  { label: 'Monthly totals', sql: `SELECT substr(occurred_on, 1, 7) AS month, kind,\n  SUM(ABS(amount_minor))/100.0 AS total\nFROM transactions\nGROUP BY month, kind\nORDER BY month DESC` },
  { label: 'Category spend', sql: `SELECT c.name, c.icon,\n  SUM(ABS(t.amount_minor))/100.0 AS spent\nFROM transactions t\nJOIN categories c ON c.id = t.category_id\nWHERE t.kind = 'expense'\nGROUP BY c.id\nORDER BY spent DESC` },
  { label: 'Account balances', sql: `SELECT a.name, a.currency,\n  (a.opening_balance_minor + COALESCE(SUM(t.amount_minor), 0))/100.0 AS balance\nFROM accounts a\nLEFT JOIN transactions t ON t.account_id = a.id\n  AND t.occurred_on <= date('now')  -- as-of-today: ignore future-dated entries\nGROUP BY a.id` },
  { label: 'All tables', sql: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name` },
];

const ROLLBACK = new Error('rollback');

export function SqlConsole() {
  const db = useDB();
  const [sql, setSql] = useState(EXAMPLE_QUERIES[0].sql);
  const [result, setResult] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const run = async () => {
    const trimmed = sql.trim();
    if (!trimmed) return;

    const cleaned = trimmed.replace(/;\s*$/, '');
    if (cleaned.includes(';')) {
      setError('Only one statement at a time. Remove extra semicolons.');
      setResult(null);
      return;
    }

    const lower = cleaned.toLowerCase();
    if (!lower.startsWith('select') && !lower.startsWith('with') && !lower.startsWith('explain') && !lower.startsWith('pragma')) {
      setError('Only SELECT / WITH / EXPLAIN / PRAGMA queries are allowed.');
      setResult(null);
      return;
    }

    setRunning(true);
    setError(null);
    try {
      // The prefix check above doesn't make it read-only ("WITH … DELETE" is
      // valid SQL), so run it in a transaction that is always rolled back.
      let rows: Record<string, unknown>[] = [];
      await db
        .tx(async (tx) => {
          rows = (await tx.execO<Record<string, unknown>>(cleaned)) ?? [];
          throw ROLLBACK;
        })
        .catch((e: unknown) => {
          if (e !== ROLLBACK) throw e;
        });
      if (rows.length === 0) {
        setResult({ columns: [], rows: [] });
      } else {
        const columns = Object.keys(rows[0]);
        setResult({
          columns,
          rows: rows.map((r) => columns.map((c) => r[c])),
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    if (!result || result.rows.length === 0) return;
    const header = result.columns.join(',');
    const body = result.rows
      .map((r) =>
        r.map((v) => {
          const s = v == null ? '' : String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        }).join(','),
      )
      .join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query_result.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell title="SQL console" subtitle="Read-only playground over your local database">
      <div className="flex flex-wrap items-center gap-2">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => setSql(q.sql)}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-400 transition hover:border-brand-500 hover:text-slate-50"
          >
            {q.label}
          </button>
        ))}
        <InfoHint label="A note on amounts">
          Amounts live in <span className="font-medium text-slate-300">amount_minor</span> as
          whole minor units (e.g. fils or cents), so divide by 100 to get the value you’d read
          on screen.
        </InfoHint>
      </div>

      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
          className="h-36 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-success placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
          placeholder="SELECT * FROM transactions LIMIT 10"
          spellCheck={false}
        />
        <div className="flex items-center gap-2">
          <Button onClick={run} disabled={running}>
            {running ? 'Running…' : 'Run (⌘↵)'}
          </Button>
          {result && result.rows.length > 0 && (
            <Button variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <Card className="overflow-x-auto !p-0">
          {result.rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">No rows returned.</div>
          ) : (
            <>
              <div className="px-4 py-2 text-xs text-slate-500">
                {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/60">
                    {result.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 500).map((row, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      {row.map((val, j) => (
                        <td key={j} className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-200">
                          {val == null ? <span className="text-slate-600">NULL</span> : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 500 && (
                <div className="px-4 py-2 text-xs text-slate-500">
                  Showing first 500 of {result.rows.length} rows. Use LIMIT for better performance.
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </PageShell>
  );
}

import { useState, useRef } from 'react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { InfoHint } from '@/components/ui/InfoHint';
import { Card } from '@/components/ui/Card';
import { useDB } from '@/db/DBProvider';

const EXAMPLE_QUERIES = [
  { label: 'Monthly totals', sql: `SELECT substr(occurred_on, 1, 7) AS month, kind,\n  SUM(ABS(amount_minor))/100.0 AS total\nFROM transactions\nGROUP BY month, kind\nORDER BY month DESC` },
  { label: 'Category spend', sql: `SELECT c.name, c.icon,\n  SUM(ABS(t.amount_minor))/100.0 AS spent\nFROM transactions t\nJOIN categories c ON c.id = t.category_id\nWHERE t.kind = 'expense'\nGROUP BY c.id\nORDER BY spent DESC` },
  { label: 'Account balances', sql: `SELECT a.name, a.currency,\n  (a.opening_balance_minor + COALESCE(SUM(t.amount_minor), 0))/100.0 AS balance\nFROM accounts a\nLEFT JOIN transactions t ON t.account_id = a.id\n  AND t.occurred_on <= date('now', 'localtime')  -- as of today: future-dated entries are scheduled\n  AND (a.starts_on = '' OR t.occurred_on >= a.starts_on)\nWHERE a.archived_at IS NULL\nGROUP BY a.id` },
  { label: 'All tables', sql: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name` },
];

const ROLLBACK = new Error('rollback');

// What an AI assistant needs to write correct queries against this book, pasted
// above the live table definitions by "Copy guide for AI".
const AI_GUIDE = `This is the SQLite database of Copper, a personal expense tracker. Write
read-only SQLite queries (one statement, SELECT or WITH) for its SQL console.

Conventions:
- Money is in integer minor units: amount_minor, opening_balance_minor,
  credit_limit_minor. Divide by 10^decimals of the account's currency
  (accounts.currency, ISO code): 2 for most, 0 for JPY/KRW, 3 for BHD/KWD/OMR.
- transactions.amount_minor is signed: expenses negative, income positive.
- transactions.kind: 'expense' | 'income' | 'transfer'. A transfer is two rows
  (one per account) linked by transfer_peer_id: negative on the account money
  left, positive on the one it reached. Leave transfers out of spending and
  income totals.
- Dates (occurred_on, starts_on) are local calendar dates 'YYYY-MM-DD'; for
  today use date('now', 'localtime'). Entries dated after today are scheduled
  (e.g. future EMIs): leave them out of balances and "spent so far".
- Balance of an account = opening_balance_minor + SUM(amount_minor) over its
  transactions with occurred_on <= today and (starts_on = '' or occurred_on >=
  starts_on).
- accounts.type: cash, bank, credit_card, wallet, loan, other. Card and loan
  balances are negative when owed. include_in_total = 0 means the account is
  left out of the overall total. archived_at set = archived (hidden).
- categories.kind: 'expense' | 'income'; parent_id nests a category under
  another. category_id is NULL on transfers and uncategorized entries.
- Accounts can hold different currencies; don't add amounts across currencies.
- Ignore tables whose names contain "crsql" (sync internals), and meta,
  change_log and devices unless asked about history or devices.

Tables:`;

export function SqlConsole() {
  const db = useDB();
  const [sql, setSql] = useState(EXAMPLE_QUERIES[0].sql);
  const [result, setResult] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<'guide' | 'table' | null>(null);

  const copy = async (what: 'guide' | 'table', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Couldn’t copy to the clipboard. Allow clipboard access for this site and try again.');
    }
  };

  const copyGuide = async () => {
    const tables = await db.execO<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL
         AND name NOT LIKE '%crsql%' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    await copy('guide', `${AI_GUIDE}\n\n${tables.map((t) => `${t.sql};`).join('\n\n')}\n`);
  };

  const copyTable = () => {
    if (!result || result.rows.length === 0) return;
    const cell = (v: unknown) => (v == null ? '' : String(v)).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [
      `| ${result.columns.map(cell).join(' | ')} |`,
      `| ${result.columns.map(() => '---').join(' | ')} |`,
      ...result.rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    ];
    void copy('table', lines.join('\n'));
  };

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
        <button
          type="button"
          onClick={copyGuide}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-400 transition hover:border-brand-500 hover:text-slate-50"
        >
          {copied === 'guide' ? 'Copied' : 'Copy guide for AI'}
        </button>
        <InfoHint label="A note on amounts">
          Amounts live in <span className="font-medium text-slate-300">amount_minor</span> as
          whole minor units (e.g. fils or cents), so divide by 100 to get the value you’d read
          on screen.
          <span className="mt-1.5 block">
            <span className="font-medium text-slate-300">Copy guide for AI</span> copies your
            tables and how they work, to paste into an AI chat so it can write queries for you.
            It holds no entries or amounts.
          </span>
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
            <>
              <Button variant="secondary" onClick={exportCsv}>
                Export CSV
              </Button>
              <Button variant="secondary" onClick={copyTable}>
                {copied === 'table' ? 'Copied' : 'Copy table'}
              </Button>
            </>
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

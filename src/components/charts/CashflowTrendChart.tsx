import { useState } from 'react';
import { formatMoney } from '@/lib/money';

export interface MonthPoint {
  month: string; // YYYY-MM
  income: number; // minor units, default currency
  expenses: number; // minor units, default currency
}

interface Props {
  /** Months sorted newest-first (as produced by Reports). */
  data: MonthPoint[];
  currency: string;
  /** How many recent months to plot. */
  months?: number;
  /**
   * When true, `data` is already oldest→newest and plotted as-is (no reslice).
   * Used by the Cashflow trend view, which appends projected months.
   */
  chronological?: boolean;
  /** Index (into oldest→newest data) of the first projected month, if any. */
  projectedFromIndex?: number;
}

const VB_W = 720;
const VB_H = 300;
const PAD_X = 10;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;

function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? ym;
}

/**
 * Diverging cashflow chart: income rises above a zero axis, expense drops
 * below it, and a net line threads through — all on one symmetric scale, so
 * the gap between the line and the axis reads as profit or loss at a glance.
 */
export function CashflowTrendChart({
  data,
  currency,
  months = 12,
  chronological = false,
  projectedFromIndex,
}: Props) {
  const series = chronological ? data : data.slice(0, months).reverse();
  const hasProjection = projectedFromIndex !== undefined && projectedFromIndex < series.length;
  const lastActual = hasProjection ? projectedFromIndex - 1 : series.length - 1;
  const [active, setActive] = useState<number>(lastActual >= 0 ? lastActual : series.length - 1);

  if (series.length === 0) return null;

  const isProjected = (i: number) => hasProjection && i >= projectedFromIndex;

  const scale = Math.max(
    1,
    ...series.map((d) => Math.max(d.income, d.expenses)),
  );

  const plotW = VB_W - PAD_X * 2;
  const plotH = VB_H - PAD_TOP - PAD_BOTTOM;
  const axisY = PAD_TOP + plotH / 2;
  const halfH = plotH / 2;
  const slot = plotW / series.length;
  const barW = Math.min(slot * 0.5, 34);

  const cx = (i: number) => PAD_X + slot * i + slot / 2;
  const incH = (v: number) => (v / scale) * halfH;
  const netY = (net: number) => axisY - (net / scale) * halfH;

  const netPoints = series
    .map((d, i) => `${cx(i)},${netY(d.income - d.expenses)}`)
    .join(' ');

  const sel = series[active] ?? series[series.length - 1];
  const selNet = sel.income - sel.expenses;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {monthLabel(sel.month)} {sel.month.slice(0, 4)}
            {isProjected(active) ? ' · projected' : ''}
          </div>
          <div
            className={`font-display text-2xl font-semibold tabular-nums ${
              selNet >= 0 ? 'text-mint-400' : 'text-clay-400'
            }`}
          >
            {formatMoney(selNet, currency, { signed: true })}
            <span className="ml-1 text-xs font-normal text-slate-500">net</span>
          </div>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="h-2.5 w-2.5 rounded-sm bg-mint-400" />
            Income <span className="tabular-nums text-slate-300">{formatMoney(sel.income, currency)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="h-2.5 w-2.5 rounded-sm bg-clay-400" />
            Expense <span className="tabular-nums text-slate-300">{formatMoney(sel.expenses, currency)}</span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Monthly income, expense and net trend"
      >
        {/* zero axis */}
        <line x1={PAD_X} y1={axisY} x2={VB_W - PAD_X} y2={axisY} className="stroke-slate-700" strokeWidth={1} />

        {/* now divider, between last actual and first projected month */}
        {hasProjection && lastActual >= 0 && (
          <line
            x1={(cx(lastActual) + cx(lastActual + 1)) / 2}
            y1={PAD_TOP}
            x2={(cx(lastActual) + cx(lastActual + 1)) / 2}
            y2={PAD_TOP + plotH}
            className="stroke-slate-600"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {series.map((d, i) => {
          const isActive = i === active;
          return (
            <g key={d.month}>
              {/* hit area + active highlight */}
              <rect
                x={cx(i) - slot / 2}
                y={PAD_TOP}
                width={slot}
                height={plotH}
                className={isActive ? 'fill-slate-500/10' : 'fill-transparent'}
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}
                style={{ cursor: 'pointer' }}
              />
              {/* income (up) */}
              <rect
                x={cx(i) - barW / 2}
                y={axisY - incH(d.income)}
                width={barW}
                height={incH(d.income)}
                rx={2}
                className="pointer-events-none fill-mint-400"
                opacity={isProjected(i) ? (isActive ? 0.6 : 0.3) : isActive ? 1 : 0.55}
              />
              {/* expense (down) */}
              <rect
                x={cx(i) - barW / 2}
                y={axisY}
                width={barW}
                height={incH(d.expenses)}
                rx={2}
                className="pointer-events-none fill-clay-400"
                opacity={isProjected(i) ? (isActive ? 0.6 : 0.3) : isActive ? 1 : 0.55}
              />
              <text
                x={cx(i)}
                y={VB_H - 10}
                textAnchor="middle"
                className={`pointer-events-none fill-slate-500 ${isActive ? 'fill-slate-300' : ''}`}
                fontSize={13}
              >
                {monthLabel(d.month)}
              </text>
            </g>
          );
        })}

        {/* net line — actual (solid) then projected (dashed) */}
        {hasProjection ? (
          <>
            <polyline
              points={series
                .slice(0, lastActual + 1)
                .map((d, i) => `${cx(i)},${netY(d.income - d.expenses)}`)
                .join(' ')}
              fill="none"
              className="pointer-events-none stroke-brand-500"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={series
                .slice(Math.max(0, lastActual))
                .map((d, k) => `${cx(Math.max(0, lastActual) + k)},${netY(d.income - d.expenses)}`)
                .join(' ')}
              fill="none"
              className="pointer-events-none stroke-brand-500/70"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        ) : (
          <polyline
            points={netPoints}
            fill="none"
            className="pointer-events-none stroke-brand-500"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {series.map((d, i) => (
          <circle
            key={d.month}
            cx={cx(i)}
            cy={netY(d.income - d.expenses)}
            r={i === active ? 4 : 2.5}
            className={`pointer-events-none ${isProjected(i) ? 'fill-brand-500/60' : 'fill-brand-500'}`}
          />
        ))}
      </svg>

      {hasProjection && (
        <p className="text-xs text-slate-500">
          Faded bars and the dashed net line are projected — every future month repeats the average
          income and expense of the months before the marker.
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { formatMoney } from '@/lib/money';
import type { BalancePoint } from '@/features/cashflow/trends';

interface Props {
  /** Oldest → newest. Actual points first, then projected. */
  data: BalancePoint[];
  currency: string;
  /** Months of history used to compute the projection — for the legend note. */
  windowMonths: number;
}

const VB_W = 720;
const VB_H = 280;
const PAD_L = 8;
const PAD_R = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Month names fit ~8 across; bare years are short enough for ~10.
const MAX_LABELS = 8;
const MAX_YEAR_LABELS = 10;

/** "Feb 2024". */
function monthYear(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
}

/**
 * Axis labels, a handful at most, on calendar boundaries so a thinned axis never
 * reads "Jan 2019, Feb, Mar…" across years: every 1/2/3/6 months with the year
 * on January and the first label, or just the years over a long range.
 */
export function axisLabels(yms: string[]): (string | null)[] {
  const step = [1, 2, 3, 6, 12, 24, 36, 60].find((s) => yms.length / s <= (s >= 12 ? MAX_YEAR_LABELS : MAX_LABELS)) ?? 120;
  let first = true;
  return yms.map((ym) => {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    if (((year * 12 + month - 1) % step) !== 0) return null;
    const label = step >= 12 ? String(year) : month === 1 || first ? monthYear(ym) : MONTHS[month - 1];
    first = false;
    return label;
  });
}

/**
 * End-of-day balance over time: a solid line for actual month-end balances and
 * a dashed continuation for the flat-average projection, split by a "now"
 * marker. A zero baseline is drawn whenever the range crosses it.
 */
export function BalanceTrendChart({ data, currency, windowMonths }: Props) {
  const firstProjected = data.findIndex((p) => p.projected);
  const lastActualIdx = firstProjected === -1 ? data.length - 1 : firstProjected - 1;
  const [active, setActive] = useState<number>(lastActualIdx >= 0 ? lastActualIdx : data.length - 1);

  if (data.length === 0) return null;

  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_TOP - PAD_BOTTOM;

  const values = data.map((p) => p.balance_minor);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const span = rawMax - rawMin || 1;
  // A touch of headroom so points don't sit on the frame.
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const x = (i: number) => (data.length === 1 ? PAD_L + plotW / 2 : PAD_L + (plotW * i) / (data.length - 1));
  const y = (v: number) => PAD_TOP + plotH * (1 - (v - min) / (max - min));

  const actualPts = data.filter((_, i) => i <= lastActualIdx);
  const actualLine = actualPts.map((p, i) => `${x(i)},${y(p.balance_minor)}`).join(' ');
  const projLine =
    firstProjected === -1
      ? ''
      : data
          .slice(lastActualIdx) // include the join point so the dashed line connects
          .map((p, k) => `${x(lastActualIdx + k)},${y(p.balance_minor)}`)
          .join(' ');

  const zeroInRange = min < 0 && max > 0;
  const sel = data[active] ?? data[data.length - 1];
  const hasProjection = firstProjected !== -1;
  const nowX = lastActualIdx >= 0 ? x(lastActualIdx) : null;

  const labels = axisLabels(data.map((p) => p.ym));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {monthYear(sel.ym)} {sel.projected ? '· projected' : ''}
          </div>
          <div
            className={`font-display text-2xl font-semibold tabular-nums ${
              sel.balance_minor < 0 ? 'text-clay-400' : 'text-slate-50'
            }`}
          >
            {formatMoney(sel.balance_minor, currency)}
            <span className="ml-1 text-xs font-normal text-slate-500">balance</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="h-0.5 w-4 rounded bg-brand-500" />
            Actual
          </span>
          {hasProjection && (
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
              Projected
            </span>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full" role="img" aria-label="Balance over time">
        {zeroInRange && (
          <line x1={PAD_L} y1={y(0)} x2={VB_W - PAD_R} y2={y(0)} className="stroke-slate-700" strokeWidth={1} />
        )}

        {nowX !== null && hasProjection && (
          <line
            x1={nowX}
            y1={PAD_TOP}
            x2={nowX}
            y2={PAD_TOP + plotH}
            className="stroke-slate-600"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {projLine && (
          <polyline
            points={projLine}
            fill="none"
            className="stroke-slate-400"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <polyline
          points={actualLine}
          fill="none"
          className="stroke-brand-500"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((p, i) => (
          <g key={p.ym}>
            <rect
              x={x(i) - plotW / (2 * Math.max(1, data.length - 1))}
              y={PAD_TOP}
              width={plotW / Math.max(1, data.length - 1)}
              height={plotH}
              className={i === active ? 'fill-slate-500/10' : 'fill-transparent'}
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              style={{ cursor: 'pointer' }}
            />
            <circle
              cx={x(i)}
              cy={y(p.balance_minor)}
              r={i === active ? 4 : 2}
              className={`pointer-events-none ${p.projected ? 'fill-slate-400' : 'fill-brand-500'}`}
            />
            {labels[i] && (
              <text
                x={x(i)}
                y={VB_H - 9}
                // Labels at the very edges grow inward so they aren't cut off.
                textAnchor={x(i) < PAD_L + 24 ? 'start' : x(i) > VB_W - PAD_R - 24 ? 'end' : 'middle'}
                className={`pointer-events-none fill-slate-500 ${i === active ? 'fill-slate-300' : ''}`}
                fontSize={12}
              >
                {labels[i]}
              </text>
            )}
          </g>
        ))}
      </svg>

      {hasProjection && (
        <p className="text-xs text-slate-500">
          Dashed line projects the balance forward using the average monthly net of the last{' '}
          {windowMonths} months.
        </p>
      )}
    </div>
  );
}

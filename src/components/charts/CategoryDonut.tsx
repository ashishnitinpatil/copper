import { formatMoney } from '@/lib/money';

export interface DonutSlice {
  id: string;
  label: string;
  value: number; // minor units
  color: string;
}

interface Props {
  slices: DonutSlice[];
  total: number;
  currency: string;
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
}

const R = 70;
const STROKE = 26;
const C = 2 * Math.PI * R;
// A thin gap between slices so neighbours with similar colours stay distinct.
const GAP = 2;

// The amount in the hole shrinks to fit it: the hole is about 60% of the
// donut's width, and a character of the display face about 0.6em wide.
function fitHole(text: string): string {
  return `min(1.25rem, ${(90 / text.length).toFixed(1)}cqi)`;
}

/** Spending share by category; the hole shows the total, or the slice you point at. */
export function CategoryDonut({ slices, total, currency, activeId, onActiveChange }: Props) {
  const active = slices.find((s) => s.id === activeId) ?? null;
  const amount = formatMoney(active ? active.value : total, currency);
  let offset = 0;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[15rem] [container-type:inline-size]">
      <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" role="img" aria-label="Spending by category">
        <circle cx={90} cy={90} r={R} fill="none" strokeWidth={STROKE} className="stroke-slate-800" />
        {slices.map((s) => {
          const len = total > 0 ? (s.value / total) * C : 0;
          const dash = Math.max(0, len - (slices.length > 1 ? GAP : 0));
          const el = (
            <circle
              key={s.id}
              cx={90}
              cy={90}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={activeId === s.id ? STROKE + 6 : STROKE}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              opacity={activeId && activeId !== s.id ? 0.35 : 1}
              className="cursor-pointer transition-all duration-150"
              onPointerEnter={() => onActiveChange(s.id)}
              onPointerLeave={() => onActiveChange(null)}
              onClick={() => onActiveChange(activeId === s.id ? null : s.id)}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[22%] text-center">
        <span className="max-w-full truncate text-xs text-slate-400">{active ? active.label : 'Spent'}</span>
        <span
          className="whitespace-nowrap font-display font-semibold tabular-nums text-slate-50"
          style={{ fontSize: fitHole(amount) }}
        >
          {amount}
        </span>
        {active && total > 0 && (
          <span className="text-xs tabular-nums text-slate-500">{((active.value / total) * 100).toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
}

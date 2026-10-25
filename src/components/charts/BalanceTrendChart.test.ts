import { describe, expect, it } from 'vitest';
import { axisLabels } from './BalanceTrendChart';

function months(from: string, count: number): string[] {
  const [y, m] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const t = y * 12 + (m - 1) + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  });
}

describe('axisLabels', () => {
  it('labels every month of a short range, with the year on the first and on January', () => {
    expect(axisLabels(months('2025-11', 4))).toEqual(['Nov 2025', 'Dec', 'Jan 2026', 'Feb']);
  });

  it('labels only years over a long range, never months that drift across years', () => {
    const labels = axisLabels(months('2019-03', 100)).filter(Boolean);
    expect(labels).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027']);
  });

  it('thins a mid range on calendar boundaries and keeps it to about 8 labels', () => {
    const labels = axisLabels(months('2024-02', 18)).filter(Boolean);
    expect(labels).toEqual(['Apr 2024', 'Jul', 'Oct', 'Jan 2025', 'Apr', 'Jul']);
  });
});

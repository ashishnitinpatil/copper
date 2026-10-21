import { ICON_WORDS } from './iconWords';

const normalize = (icon: string) => icon.trim().replace(/️/g, '');
const wordsOf = (icon: string) => (ICON_WORDS[normalize(icon)] ?? '').split(' ').filter(Boolean);

/** An icon's plain name ("fuel"), for labels; the emoji itself if it has none. */
export function iconName(icon: string): string {
  return wordsOf(icon)[0] ?? icon;
}

// "petr" finds "petrol"; "groceries" finds "grocery". Short fragments only
// match word starts so two letters don't light up half the grid.
function matches(term: string, word: string): boolean {
  if (word.startsWith(term)) return true;
  return term.length >= 4 && term.startsWith(word.slice(0, Math.max(4, word.length - 2)));
}

/** Icons whose words match everything typed, in the order given. */
export function searchIcons(query: string, icons: string[]): string[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (terms.length === 0) return [];
  return icons.filter((i) => {
    const words = wordsOf(i);
    return terms.every((t) => words.some((w) => matches(t, w)));
  });
}

/**
 * Icons that fit a name like "Eating out" or "HDFC Credit Card", best first:
 * more of the name's words matched, then an earlier word of the icon's list.
 */
export function suggestIcons(name: string, icons: string[], max = 6): string[] {
  const terms = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (terms.length === 0) return [];
  return icons
    .map((icon, order) => {
      const words = wordsOf(icon);
      let hits = 0;
      let first = Infinity;
      for (const t of terms) {
        const at = words.findIndex((w) => matches(t, w));
        if (at >= 0) {
          hits++;
          first = Math.min(first, at);
        }
      }
      return { icon, hits, first, order };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.first - b.first || a.order - b.order)
    .slice(0, max)
    .map((s) => s.icon);
}

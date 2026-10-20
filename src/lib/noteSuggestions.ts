/** A note used before, with how often and how recently. */
export interface PastNote {
  note: string;
  uses: number;
  last_on: string;
}

/**
 * Earlier notes worth offering while someone types one: those containing what
 * they typed, notes that start with it (or have a word that does) first, then
 * the most used, then the most recent. Nothing until they type, and never the
 * note they've already written in full.
 */
export function suggestNotes(past: PastNote[], typed: string, max = 4): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const rank = (n: string) => {
    const lower = n.toLowerCase();
    if (lower.startsWith(q)) return 0;
    if (lower.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    return 2;
  };
  return past
    .filter((p) => {
      const lower = p.note.trim().toLowerCase();
      return lower !== q && lower.includes(q);
    })
    .sort(
      (a, b) =>
        rank(a.note) - rank(b.note) || b.uses - a.uses || (a.last_on < b.last_on ? 1 : a.last_on > b.last_on ? -1 : 0),
    )
    .slice(0, max)
    .map((p) => p.note.trim());
}

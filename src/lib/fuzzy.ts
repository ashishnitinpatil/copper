/**
 * Small dependency-free fuzzy matcher for the transactions search box.
 * SQLite (wa-sqlite) here has no FTS or edit-distance functions, so search
 * candidates are pulled with the structured filters and ranked in JS with
 * fuzzyScore(). Kept pure so it can be unit-tested without a DB.
 */

/** Lowercased alphanumeric word tokens. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

/** Levenshtein edit distance, bailing out to `max + 1` once it exceeds `max`. */
export function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** True if every char of `q` appears in `t` in order (catches dropped letters). */
function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (q[i] === t[j]) i++;
  }
  return i === q.length;
}

/** Relevance of one query word against one text word, 0..1. */
function tokenScore(q: string, t: string): number {
  if (q === t) return 1;
  if (t.startsWith(q)) return 0.92;
  if (t.includes(q)) return 0.82;
  // Typo tolerance, but only for words long enough that a fuzzy hit is meaningful.
  if (q.length >= 3) {
    const maxEdits = q.length <= 4 ? 1 : 2;
    const dist = levenshtein(q, t, maxEdits);
    if (dist <= maxEdits) return 0.7 - 0.15 * dist;
    if (t.length - q.length <= 3 && isSubsequence(q, t)) return 0.6;
  }
  return 0;
}

/**
 * Fuzzy relevance of `query` against `text`, from 0 (no match) to 1 (exact).
 * Multi-word queries are AND-ed: every query word must match some text word,
 * and the score is their average so closer overall matches rank higher.
 */
export function fuzzyScore(query: string, text: string): number {
  const qTokens = tokenize(query);
  const tTokens = tokenize(text);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;
  let total = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const t of tTokens) {
      const s = tokenScore(q, t);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best === 0) return 0; // a query word matched nothing → not a result
    total += best;
  }
  return total / qTokens.length;
}

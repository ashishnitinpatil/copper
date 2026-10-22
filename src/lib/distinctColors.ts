// Chart slices need colours people can tell apart. Category colours often
// aren't: imported categories get one of a few hashed colours, so two greens
// can sit side by side. Colours are compared in OKLab, where distance tracks
// what the eye sees.

/** Below this OKLab distance two slice colours read as the same. */
const TOO_CLOSE = 0.08;

// Replacements, each at least 0.099 from every other and from the grey "more"
// slice. Sky comes last: it's close to that grey.
const SLICE_PALETTE = [
  '#E6A532', // gold
  '#6FBF9B', // mint
  '#E08A6B', // clay
  '#C792EA', // violet
  '#E06C9F', // rose
  '#9AA33A', // olive
  '#7A86E0', // indigo
  '#B8553F', // brick
  '#3F8F7A', // pine
  '#7FB3D5', // sky
];

type Lab = [number, number, number];

function toOklab(hex: string): Lab | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
  ];
}

export function colorDistance(a: string, b: string): number {
  const x = toOklab(a);
  const y = toOklab(b);
  if (!x || !y) return Infinity;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * `colors` (biggest slice first) with any that clash with an earlier one — or
 * with a `fixed` colour such as the grey "N more" slice — swapped for a
 * distinct one. Colours that already stand apart are kept, so a category keeps
 * its own colour whenever it can.
 */
export function distinctColors(colors: string[], fixed: string[] = []): string[] {
  const used = [...fixed];
  const distinct = (c: string) => used.every((u) => colorDistance(c, u) >= TOO_CLOSE);
  return colors.map((c) => {
    const pick = distinct(c) ? c : (SLICE_PALETTE.find(distinct) ?? c);
    used.push(pick);
    return pick;
  });
}

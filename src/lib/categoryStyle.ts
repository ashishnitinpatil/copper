// Gives every category a color and a glyph so the picker grid feels alive even
// for imported categories that carry no icon or color of their own. Stored
// icon/color always win; otherwise we derive a stable color (hashed from the
// name) and a monogram fallback.
const FALLBACK_PALETTE = [
  '#E6A532', // gold
  '#6FBF9B', // mint
  '#E08A6B', // clay
  '#7FB3D5', // sky
  '#C792EA', // violet
  '#E5C07B', // sand
  '#56B6C2', // teal
  '#D19A66', // amber
  '#98C379', // leaf
  '#E06C9F', // rose
];

export interface CategoryStyle {
  color: string;
  glyph: string;
  isMonogram: boolean;
}

export function categoryStyle(
  name: string,
  color?: string | null,
  icon?: string | null,
): CategoryStyle {
  const hasIcon = !!icon && icon.trim().length > 0;
  const hasColor = !!color && color.trim().length > 0;
  return {
    color: hasColor ? color!.trim() : FALLBACK_PALETTE[hashString(name) % FALLBACK_PALETTE.length],
    glyph: hasIcon ? icon!.trim() : monogram(name),
    isMonogram: !hasIcon,
  };
}

function monogram(name: string): string {
  const parts = name.trim().split(/[\s/&_-]+/).filter(Boolean);
  if (parts.length === 0) return '•';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

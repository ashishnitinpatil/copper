import type { CSSProperties } from 'react';
import { categoryStyle } from '@/lib/categoryStyle';
import { Glyph } from './Glyph';

interface CategoryCoinProps {
  name: string;
  color?: string | null;
  icon?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'h-8 w-8 text-base',
  md: 'h-10 w-10 text-xl',
  lg: 'h-12 w-12 text-2xl',
} as const;

// A colored disc carrying a category's icon (or a derived monogram). The disc is
// tinted with the category color so even icon-less categories read at a glance.
// Tint + glyph color are derived from --coin in CSS so light themes can darken
// the (often pastel) hue enough to stay legible on a pale tile.
export function CategoryCoin({ name, color, icon, size = 'md', className = '' }: CategoryCoinProps) {
  const st = categoryStyle(name, color, icon);
  return (
    <span
      className={`coin-disc inline-flex shrink-0 items-center justify-center rounded-full leading-none ${SIZES[size]} ${className}`}
      style={{ '--coin': st.color } as CSSProperties}
    >
      {st.isMonogram ? (
        <span className="text-[0.62em] font-bold tracking-tight">{st.glyph}</span>
      ) : (
        <Glyph icon={st.glyph} className="h-[1.05em] w-[1.05em]" />
      )}
    </span>
  );
}

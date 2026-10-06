import type { ReactNode } from 'react';

interface InfoHintProps {
  /** Accessible name for the trigger (e.g. "How search works"). */
  label: string;
  /** Optional bold heading shown above the body. */
  title?: string;
  /** Tip content. */
  children: ReactNode;
  /**
   * Which edge of the popover aligns to the icon. Use "right" for triggers near
   * the right edge of the screen so the popover opens leftward. Default "left".
   */
  align?: 'left' | 'right';
}

/**
 * A small "?" affordance that reveals a short tip on hover or keyboard focus.
 * Icon-only by default so it stays out of the way; the popover is pure CSS
 * (group-hover / group-focus-within) and inherits the active theme's tokens.
 */
export function InfoHint({ label, title, children, align = 'left' }: InfoHintProps) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] font-semibold leading-none text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-300 focus:border-brand-400 focus:text-brand-300 focus:outline-none"
      >
        ?
      </button>
      <span
        role="tooltip"
        // display:none while closed: a hidden-but-laid-out 16rem popover near
        // the screen edge would widen the page. On phones it opens as a panel
        // inset from both edges (above the bottom nav) instead of off-screen.
        className={`absolute top-6 z-20 hidden w-64 group-hover:block group-focus-within:block max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:bottom-24 max-sm:w-auto rounded-lg border border-slate-700 bg-slate-900 p-3 text-left font-normal normal-case tracking-normal shadow-xl ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {title && (
          <span className="mb-2 block text-xs font-semibold normal-case tracking-normal text-slate-200">
            {title}
          </span>
        )}
        <span className="block text-xs leading-relaxed text-slate-400">{children}</span>
      </span>
    </span>
  );
}

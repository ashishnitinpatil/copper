import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass a fresh onClose on every render. Kept in a ref so a parent
  // re-render (say, a sync refreshing the list behind the dialog) doesn't re-run
  // the effect below and pull focus out of the field being typed in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Where the press began: a text selection dragged out of the dialog ends on
  // the backdrop, and that must not close it and lose what was typed.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    // Move focus into the dialog so keyboard and screen-reader users land here.
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Trap Tab within the dialog.
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // Portal to <body>. Rendered in place, the overlay sits under whatever page
  // block contains it — and the page-enter animation leaves a transform on
  // those blocks, which makes them the containing block for position:fixed
  // descendants. That traps the overlay in the block's box instead of covering
  // the viewport, letting later siblings paint over the dialog and swallow
  // clicks on its buttons.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`max-h-[90vh] w-full overflow-y-auto ${SIZES[size]} rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id={titleId} className="mb-4 text-lg font-semibold text-slate-50">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import { undoLast } from '@/features/undo/undo';
import { useDefaultCurrency } from './AppSettingsProvider';

/** Fired after Ctrl+Z undoes something, so pages can drop stale "saved" notices. */
export const UNDO_EVENT = 'copper:undo';
const OFFER_UNDO_EVENT = 'copper:offer-undo';

/**
 * After a change with no other way back on a phone (a delete), show a notice
 * with an Undo button. It runs the same undo as Ctrl+Z: the latest change.
 */
export function offerUndo(text: string) {
  window.dispatchEvent(new CustomEvent(OFFER_UNDO_EVENT, { detail: text }));
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: [MOD, 'Z'], what: 'Undo your last change' },
  { keys: ['A'], what: 'Add a transaction' },
  { keys: ['T'], what: 'Go to transactions' },
  { keys: ['/'], what: 'Search transactions' },
  { keys: ['?'], what: 'Show these shortcuts' },
];

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Wait for an element to appear after navigating, then focus it. */
function focusWhenReady(selector: string, tries = 30) {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.focus();
  else if (tries > 0) setTimeout(() => focusWhenReady(selector, tries - 1), 50);
}

/**
 * App-wide keyboard shortcuts and quick undo. Keys are ignored while typing
 * in a field (the field keeps its own undo) and while a dialog is open.
 */
export function Shortcuts({ helpOpen, onHelpOpenChange }: { helpOpen: boolean; onHelpOpenChange: (open: boolean) => void }) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<{ text: string; ok: boolean; undoable?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const busy = useRef(false);

  const show = useCallback((text: string, ok: boolean, undoable = false) => {
    setNotice({ text, ok, undoable });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), undoable ? 8000 : ok ? 4000 : 7000);
  }, []);

  useEffect(() => {
    const onOffer = (e: Event) => show((e as CustomEvent<string>).detail, true, true);
    window.addEventListener(OFFER_UNDO_EVENT, onOffer);
    return () => window.removeEventListener(OFFER_UNDO_EVENT, onOffer);
  }, [show]);

  const undo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await undoLast(db, defaultCurrency);
      if (r.ok) {
        show(`Undone: ${r.text}`, true);
        window.dispatchEvent(new Event(UNDO_EVENT));
      }
      else show(r.reason, false);
    } catch (e) {
      show(`Couldn’t undo: ${e instanceof Error ? e.message : String(e)}`, false);
    } finally {
      busy.current = false;
    }
  }, [db, defaultCurrency, show]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        onHelpOpenChange(true);
      } else if (e.key === 'a') {
        navigate('/add');
      } else if (e.key === 't') {
        navigate('/transactions');
      } else if (e.key === '/') {
        e.preventDefault();
        navigate('/transactions');
        focusWhenReady('[data-shortcut="search"]');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, navigate, onHelpOpenChange]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <Modal open={helpOpen} onClose={() => onHelpOpenChange(false)} title="Keyboard shortcuts" size="sm">
        <ul className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <li key={s.what} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-300">{s.what}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[1.75rem] rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-center font-sans text-xs font-medium text-slate-200"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Undo works on changes made on this device since you opened Copper. On the Add page, type the
          amount with your number keys.
        </p>
      </Modal>

      {notice && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-start gap-2.5 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm shadow-2xl lg:bottom-8"
        >
          {notice.ok && !notice.undoable && <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />}
          <span className={`flex-1 ${notice.ok ? 'text-slate-100' : 'text-slate-300'}`}>{notice.text}</span>
          {notice.undoable && (
            <button
              type="button"
              onClick={() => void undo()}
              className="shrink-0 font-semibold text-brand-400 underline underline-offset-2 hover:text-brand-300"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}

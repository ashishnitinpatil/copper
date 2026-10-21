import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useDB } from '@/db/DBProvider';
import { deleteTheme, saveTheme, type CustomTheme } from '@/db/queries/themes';
import { accentWarning, buildTheme, isHexColor } from '@/lib/customTheme';
import { applyCustomTheme, applyTheme, useTheme } from '@/lib/theme';

/** A token on the page right now, as #rrggbb — new themes start from what's on screen. */
function currentColor(token: string): string {
  const parts = getComputedStyle(document.documentElement).getPropertyValue(token).trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '#000000';
  return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('');
}

const rgb = (triplet: string | undefined) => `rgb(${(triplet ?? '0 0 0').split(' ').join(',')})`;

/** Make or edit a custom theme: a name and two colours, with a live preview. */
export function ThemeEditor({ open, existing, onClose }: { open: boolean; existing: CustomTheme | null; onClose: () => void }) {
  const db = useDB();
  const active = useTheme();
  const [name, setName] = useState('');
  const [background, setBackground] = useState('#000000');
  const [accent, setAccent] = useState('#000000');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setBackground(existing?.background ?? currentColor('--s-950'));
    setAccent(existing?.accent ?? currentColor('--b-500'));
  }, [open, existing]);

  const valid = isHexColor(background) && isHexColor(accent);
  const preview = valid ? buildTheme({ background, accent }) : null;
  const warning = valid ? accentWarning({ background, accent }) : null;
  const v = preview?.vars ?? {};

  const save = async () => {
    setSaving(true);
    try {
      const theme = { id: existing?.id, name: name.trim() || 'My theme', background, accent };
      const id = await saveTheme(db, theme);
      // Saving shows it on this device; other devices only list it.
      applyCustomTheme({ ...theme, id });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    await deleteTheme(db, existing.id);
    if (active === `custom:${existing.id}`) applyTheme('copper');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit theme' : 'Make your own theme'}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My theme" maxLength={30} />
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Background" value={background} onChange={setBackground} />
          <ColorField label="Accent" value={accent} onChange={setAccent} />
        </div>
        <p className="text-xs text-slate-500">
          Light or dark follows the background. Cards, text and borders are worked out from these two.
        </p>

        {preview && (
          <div
            aria-label="Preview"
            className="rounded-xl p-3"
            style={{ backgroundColor: rgb(v['--s-950']), border: `1px solid ${rgb(v['--s-800'])}` }}
          >
            <div className="rounded-lg p-3" style={{ backgroundColor: rgb(v['--s-900']), border: `1px solid ${rgb(v['--s-800'])}` }}>
              <div className="text-sm font-semibold" style={{ color: rgb(v['--s-50']) }}>Groceries</div>
              <div className="text-xs" style={{ color: rgb(v['--s-400']) }}>Yesterday · Cash</div>
              <div className="mt-2 flex items-center justify-between gap-2 text-sm tabular-nums">
                <span style={{ color: rgb(v['--clay-400']) }}>−₹1,240</span>
                <span style={{ color: rgb(v['--mint-400']) }}>+₹52,000</span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: rgb(v['--b-500']), color: rgb(v['--s-950']) }}
                >
                  Save
                </span>
                <span className="text-xs font-medium" style={{ color: rgb(v['--b-400']) }}>
                  View all
                </span>
              </div>
            </div>
          </div>
        )}
        {warning && <p className="text-xs text-warning">{warning}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {existing ? (
            <Button type="button" variant="ghost" onClick={() => void remove()} className="text-danger">
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!valid || saving} onClick={() => void save()}>
              {existing ? 'Save' : 'Save and use'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5">
        <input
          type="color"
          aria-label={`${label} colour`}
          value={isHexColor(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          value={text}
          spellCheck={false}
          onChange={(e) => {
            const t = e.target.value.trim();
            setText(t);
            const hex = t.startsWith('#') ? t : `#${t}`;
            if (isHexColor(hex)) onChange(hex.toLowerCase());
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-slate-100 focus:outline-none"
        />
      </span>
    </label>
  );
}

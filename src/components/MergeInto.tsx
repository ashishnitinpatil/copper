import { useState } from 'react';
import { Button } from './ui/Button';
import { Combobox } from './ui/Combobox';

interface MergeIntoProps {
  /** Singular noun for copy, e.g. "category" or "account". */
  noun: string;
  /** What else rides along, e.g. "budgets, sub-categories and recurring rules". */
  extras: string;
  sourceName: string;
  /** Transactions that will move; null while still loading. */
  impact: number | null;
  options: { value: string; label: string }[];
  onMerge: (targetId: string) => Promise<void>;
}

/**
 * Consolidation control for an edit modal: pick another record to absorb this
 * one into. Collapsed by default since it's a destructive, occasional action;
 * expanding, choosing a target, and pressing the danger button is the whole
 * confirmation (no second dialog).
 */
export function MergeInto({ noun, extras, sourceName, impact, options, onMerge }: MergeIntoProps) {
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);

  const targetName = options.find((o) => o.value === target)?.label ?? '';

  const handle = async () => {
    if (!target) return;
    setMerging(true);
    try {
      await onMerge(target);
    } finally {
      setMerging(false);
    }
  };

  return (
    <details className="mt-4 border-t border-slate-800 pt-3">
      <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-200">
        Merge into another {noun}
      </summary>
      <div className="mt-3 space-y-3">
        {options.length === 0 ? (
          <p className="text-xs text-slate-500">No other {noun} is available to merge into.</p>
        ) : (
          <>
            <Combobox
              label="Move everything into"
              value={target}
              onChange={(v) => {
                setTarget(v);
                setConfirming(false);
              }}
              emptyOption={{ value: '', label: `— Choose a ${noun} —` }}
              options={options}
            />
            <p className="text-xs text-slate-500">
              Moves {impact ?? '…'} transaction{impact === 1 ? '' : 's'} from “{sourceName}”, plus
              any {extras}, then permanently deletes “{sourceName}”. This can’t be undone.
            </p>
            {confirming ? (
              <div className="space-y-2 rounded-md border border-danger/40 bg-danger/10 p-3">
                <p className="text-xs text-danger">
                  Merge “{sourceName}” into “{targetName}” and permanently delete it? There is no
                  undo — everything above moves across and “{sourceName}” is gone for good.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={merging} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" disabled={merging} onClick={handle}>
                    {merging ? 'Merging…' : 'Yes, merge & delete'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="danger"
                size="sm"
                disabled={!target}
                onClick={() => setConfirming(true)}
              >
                Merge & delete “{sourceName}”
              </Button>
            )}
          </>
        )}
      </div>
    </details>
  );
}

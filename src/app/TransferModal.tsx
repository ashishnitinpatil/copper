import { useEffect, useMemo, useState } from 'react';
import { DateField } from '@/components/ui/DateField';
import { accountOptions } from '@/components/accountOptions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import {
  createTransfer,
  deleteTransaction,
  getTransfer,
  updateTransfer,
} from '@/db/queries/transactions';
import type { Account } from '@/db/types';
import { fromMinor, parseAmount } from '@/lib/money';
import { toDateString } from '@/lib/dates';
import { useAppSettings, useConvert } from './AppSettingsProvider';
import { EntityHistory } from './Activity';
import { describeSource } from '@/components/ConvertedMark';
import { NoteSuggestions, usePastNotes } from '@/components/NoteSuggestions';
import { suggestNotes } from '@/lib/noteSuggestions';

export interface TransferDraft {
  fromId: string;
  toId: string;
  amountMinor?: number;
  date?: string;
  note?: string;
}

interface TransferModalProps {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
  /** Edit this transfer (either leg's id) instead of creating one. */
  transferId?: string | null;
  /** Pre-fill a new transfer (e.g. from the Add screen). */
  draft?: TransferDraft | null;
  /** Called after a new transfer is saved. */
  onCreated?: () => void;
}

export function TransferModal({ open, accounts, onClose, transferId, draft, onCreated }: TransferModalProps) {
  const db = useDB();
  const { defaultCurrency, fxRates, rateInfo } = useAppSettings();
  const convert = useConvert();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [receivedInput, setReceivedInput] = useState('');
  // Once the person types what actually arrived, stop overwriting it with the
  // converted estimate.
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [date, setDate] = useState(toDateString());
  const [note, setNote] = useState('');
  const pastNotes = usePastNotes('transfer', open);
  const noteSuggestions = useMemo(() => suggestNotes(pastNotes.data ?? [], note), [pastNotes.data, note]);
  const [submitting, setSubmitting] = useState(false);
  // The transfer whose values are in the form. Until it matches transferId the
  // form shows the previous use of this modal, so it isn't shown or editable.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const editing = !!transferId;

  useEffect(() => {
    if (!open) return;
    setLoadedFor(null);
    if (transferId) {
      // A load that resolves after a newer one (or after the person started
      // typing into this one) must not overwrite the form.
      let cancelled = false;
      void getTransfer(db, transferId).then((legs) => {
        if (!legs || cancelled) return;
        const fromAcct = accounts.find((a) => a.id === legs.from.account_id);
        const toAcct = accounts.find((a) => a.id === legs.to.account_id);
        setFromId(legs.from.account_id);
        setToId(legs.to.account_id);
        setAmountInput(String(fromMinor(Math.abs(legs.from.amount_minor), fromAcct?.currency ?? defaultCurrency)));
        setReceivedInput(String(fromMinor(Math.abs(legs.to.amount_minor), toAcct?.currency ?? defaultCurrency)));
        setReceivedTouched(true);
        setDate(legs.from.occurred_on);
        setNote(legs.from.note ?? '');
        setLoadedFor(transferId);
      });
      return () => {
        cancelled = true;
      };
    }
    const from = draft?.fromId ?? accounts[0]?.id ?? '';
    const fromAcct = accounts.find((a) => a.id === from);
    setFromId(from);
    setToId(draft?.toId ?? accounts.find((a) => a.id !== from)?.id ?? '');
    setAmountInput(
      draft?.amountMinor ? String(fromMinor(draft.amountMinor, fromAcct?.currency ?? defaultCurrency)) : '',
    );
    setReceivedInput('');
    setReceivedTouched(false);
    setDate(draft?.date ?? toDateString());
    setNote(draft?.note ?? '');
    // Re-seed only when the modal opens, not on every accounts refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transferId, draft, db]);

  const fromAcct = accounts.find((a) => a.id === fromId);
  const toAcct = accounts.find((a) => a.id === toId);
  const currency = fromAcct?.currency ?? defaultCurrency;
  const toCurrency = toAcct?.currency ?? currency;
  const crossCurrency = currency !== toCurrency;
  const hasRate = (c: string) => c === defaultCurrency || !!fxRates[c];
  const canEstimate = hasRate(currency) && hasRate(toCurrency);

  const amount = parseAmount(amountInput, currency);
  const received = crossCurrency ? parseAmount(receivedInput, toCurrency) : amount;

  // Pre-fill what arrives from the exchange rates in Settings, until the person
  // types the real figure. No rate → no guess (a 1:1 guess would look right).
  useEffect(() => {
    if (!crossCurrency || receivedTouched) return;
    if (!canEstimate || !amount || amount <= 0) {
      setReceivedInput('');
      return;
    }
    setReceivedInput(String(fromMinor(convert(amount, currency, toCurrency), toCurrency)));
  }, [crossCurrency, receivedTouched, canEstimate, amount, currency, toCurrency, convert]);

  const valid =
    !!fromId && !!toId && fromId !== toId && !!amount && amount > 0 && !!received && received > 0;

  const handleSubmit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const input = {
        from_account_id: fromId,
        to_account_id: toId,
        amount_minor: amount!,
        to_amount_minor: received!,
        occurred_on: date,
        note: note.trim() || null,
      };
      if (transferId) await updateTransfer(db, transferId, input);
      else {
        await createTransfer(db, input);
        onCreated?.();
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!transferId) return;
    setSubmitting(true);
    try {
      await deleteTransaction(db, transferId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit transfer' : 'New transfer'}>
      {editing && loadedFor !== transferId ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <Combobox
            label="From"
            value={fromId}
            onChange={(id) => {
              setFromId(id);
              if (id === toId) setToId(accounts.find((a) => a.id !== id)?.id ?? '');
              // A received figure typed for the old pair of accounts no longer applies.
              setReceivedTouched(false);
            }}
            options={accountOptions(accounts)}
          />
          <Combobox
            label="To"
            value={toId}
            onChange={(id) => {
              setToId(id);
              setReceivedTouched(false);
            }}
            options={accountOptions(accounts.filter((a) => a.id !== fromId))}
          />
          <Input
            label={crossCurrency ? `Amount sent (${currency})` : 'Amount'}
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
          {crossCurrency && (
            <div>
              <Input
                label={`Amount received (${toCurrency})`}
                inputMode="decimal"
                value={receivedInput}
                onChange={(e) => {
                  setReceivedTouched(true);
                  setReceivedInput(e.target.value);
                }}
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-slate-500">
                {canEstimate
                  ? `Estimated using ${[currency, toCurrency]
                      .filter((c) => c !== defaultCurrency && rateInfo[c])
                      .map((c) => describeSource(rateInfo[c].source))
                      .join(' and ')}. Enter what actually arrived if it differs.`
                  : `No exchange rate for ${[currency, toCurrency].filter((c) => !hasRate(c)).join(' and ')}. Enter what arrived.`}
              </p>
            </div>
          )}
          <DateField label="Date" value={date} onChange={setDate} />
          <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          <NoteSuggestions notes={noteSuggestions} onPick={setNote} />
          <div className="flex items-center justify-between gap-2 pt-2">
            {editing ? (
              <Button variant="danger" onClick={handleDelete} disabled={submitting}>
                Delete transfer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !valid}>
                {editing ? 'Save' : 'Transfer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing && transferId && (
        <details className="mt-4 border-t border-slate-800 pt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-200">
            History
          </summary>
          <div className="mt-2">
            <EntityHistory entity="transaction" entityId={transferId} />
          </div>
        </details>
      )}
    </Modal>
  );
}

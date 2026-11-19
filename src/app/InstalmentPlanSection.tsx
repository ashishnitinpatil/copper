import { useCallback, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DateField } from '@/components/ui/DateField';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import type { Account } from '@/db/types';
import {
  createCardPlan,
  deleteCardPlan,
  getPlanForTransaction,
  settleCardPlan,
  updateCardPlan,
  type CardPlanInfo,
} from '@/db/queries/cardPlans';
import {
  bpToMonthlyRate,
  instalmentAmount,
  interestUpfront,
  monthlyRateToBp,
  planSchedule,
  unbilledAfter,
} from '@/features/creditCards/plans';
import { dueDateAfter, nextDueDate } from '@/features/loans/loanMath';
import { formatMoney, fromMinor, parseAmount } from '@/lib/money';
import { parseDateString, toDateString } from '@/lib/dates';

interface Props {
  /** The card the entry is on. */
  card: Account;
  /** The entry on the card: a purchase, or the card's side of a transfer out. */
  transactionId: string;
  /** What it took off the card, positive. */
  amount: number;
  /** The entry's date. */
  date: string;
}

const shortDate = (s: string) =>
  parseDateString(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * On a card entry's edit dialog: pay it back in monthly instalments (an EPP, or
 * a loan on the card), and later see how far along it is, change it, or settle
 * the rest early.
 */
export function InstalmentPlanSection({ card, transactionId, amount, date }: Props) {
  const planQ = useQuery(
    useCallback((d) => getPlanForTransaction(d, transactionId), [transactionId]),
    { deps: ['card_plans', 'transactions', 'accounts'] },
  );
  const [mode, setMode] = useState<'idle' | 'edit' | 'settle'>('idle');
  const plan = planQ.data;
  if (planQ.loading && plan == null) return null;

  if (!card.statement_day) {
    return (
      <p className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-500">
        Paying this back in instalments? Add {card.name}’s statement day in Accounts first.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      {plan && mode !== 'edit' ? (
        <PlanSummary plan={plan} currency={card.currency} />
      ) : mode === 'idle' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Converted to monthly instalments (EPP), or a loan on the card?</p>
          <Button size="sm" variant="secondary" onClick={() => setMode('edit')}>
            <CalendarClock className="h-4 w-4" />
            Pay in instalments…
          </Button>
        </div>
      ) : null}

      {mode === 'edit' && (
        <PlanForm
          card={card}
          transactionId={transactionId}
          amount={amount}
          date={date}
          plan={plan}
          onDone={() => setMode('idle')}
        />
      )}
      {mode === 'settle' && plan && <SettleForm plan={plan} currency={card.currency} onDone={() => setMode('idle')} />}

      {plan && mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMode('edit')}>
            Change plan
          </Button>
          {!plan.settled_on && (
            <Button size="sm" variant="secondary" onClick={() => setMode('settle')}>
              Settle the rest…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PlanSummary({ plan, currency }: { plan: CardPlanInfo; currency: string }) {
  const today = toDateString();
  const schedule = planSchedule(plan, plan.statement_day);
  const billed = schedule.filter((i) => i.statement <= today);
  const next = schedule.find((i) => i.statement > today);
  const left = unbilledAfter(plan, plan.statement_day, today);
  const money = (n: number) => formatMoney(n, currency);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
        <CalendarClock className="h-4 w-4 text-brand-400" />
        {plan.settled_on ? 'Instalments · settled' : `Instalments · ${billed.length} of ${schedule.length} billed`}
      </div>
      <p className="text-xs text-slate-400">
        {money(instalmentAmount(plan))} a month for {plan.months} months
        {plan.rate_bp > 0
          ? ` · ${bpToMonthlyRate(plan.rate_bp)}% a month ${plan.method === 'flat' ? 'flat' : 'on what’s left'}`
          : ' · no interest'}
        {plan.fee_minor > 0 ? ` · ${money(plan.fee_minor)} fee` : ''}
        {plan.rate_bp > 0 && interestUpfront(plan) ? ' · interest added at the start' : ''}
      </p>
      <p className="text-xs text-slate-400">
        {left > 0 ? (
          <>
            <span className="font-medium text-slate-200">{money(left)}</span> still to be billed
            {next ? ` · next on the ${shortDate(next.statement)} statement` : ''}
          </>
        ) : (
          'All billed.'
        )}
      </p>
    </div>
  );
}

function PlanForm({
  card,
  transactionId,
  amount,
  date,
  plan,
  onDone,
}: Props & { plan: CardPlanInfo | null; onDone: () => void }) {
  const db = useDB();
  const currency = card.currency;
  const statementDay = card.statement_day!;
  const today = toDateString();
  // The statement the entry lands on, and the two after it.
  const firstChoices = useMemo(() => {
    const first = nextDueDate(date, statementDay);
    return [0, 1, 2].map((n) => dueDateAfter(first, n, statementDay));
  }, [date, statementDay]);

  const [principalInput, setPrincipalInput] = useState(
    String(fromMinor(plan?.principal_minor ?? amount, currency)),
  );
  const [monthsInput, setMonthsInput] = useState(String(plan?.months ?? 12));
  const [rateUnit, setRateUnit] = useState<'month' | 'year'>('month');
  const [rateInput, setRateInput] = useState(plan ? String(bpToMonthlyRate(plan.rate_bp)) : '0');
  const [method, setMethod] = useState<'reducing' | 'flat'>(plan?.method ?? 'reducing');
  const [feeInput, setFeeInput] = useState(plan?.fee_minor ? String(fromMinor(plan.fee_minor, currency)) : '');
  const [first, setFirst] = useState(plan?.first_statement ?? firstChoices[0]);
  const [addPast, setAddPast] = useState(false);
  // null: follow the method (flat plans usually have all their interest put on at the start).
  const [upfrontChoice, setUpfrontChoice] = useState<boolean | null>(plan ? interestUpfront(plan) : null);
  const [busy, setBusy] = useState(false);

  const principal = parseAmount(principalInput, currency);
  const months = Math.floor(Number(monthsInput));
  const rateNumber = Number(rateInput || 0);
  const rateBp = rateUnit === 'month' ? monthlyRateToBp(rateNumber) : Math.round(rateNumber * 100);
  const fee = feeInput ? parseAmount(feeInput, currency) : 0;
  const valid =
    !!principal && principal > 0 && principal <= amount && months >= 1 && months <= 120 &&
    Number.isFinite(rateNumber) && rateNumber >= 0 && fee != null && fee >= 0;

  const terms = valid
    ? {
        principal_minor: principal!,
        months,
        rate_bp: rateBp,
        method,
        fee_minor: fee!,
        first_statement: first,
        settled_on: null,
      }
    : null;
  const upfront = upfrontChoice ?? method === 'flat';
  const schedule = terms ? planSchedule(terms, statementDay) : [];
  const totalInterest = schedule.reduce((n, i) => n + i.interest, 0);
  // A new plan for an entry from a while back: the bank has charged some of it
  // already. That may be in Copper some other way, so it's only added on request.
  const pastStatements = !plan ? schedule.filter((i) => i.statement <= today) : [];
  const upfrontCharged = !plan && upfront && totalInterest > 0 && date <= today;
  const pastFee = pastStatements.some((i) => i.fee > 0);
  const pastCharges = upfrontCharged || pastFee || (!upfront && pastStatements.some((i) => i.interest > 0));
  const skipThrough = [date, ...pastStatements.map((i) => i.statement)].sort().pop()!;
  const money = (n: number) => formatMoney(n, currency);

  const save = async () => {
    if (!terms) return;
    setBusy(true);
    try {
      if (plan) {
        await updateCardPlan(db, plan.id, terms);
      } else {
        await createCardPlan(db, {
          ...terms,
          card_id: card.id,
          transaction_id: transactionId,
          interest_upfront: upfront ? 1 : 0,
          billedThrough: pastCharges && !addPast ? skipThrough : '',
        });
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await deleteCardPlan(db, plan.id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Amount converted"
          inputMode="decimal"
          value={principalInput}
          onChange={(e) => setPrincipalInput(e.target.value)}
        />
        <Input label="Months" inputMode="numeric" value={monthsInput} onChange={(e) => setMonthsInput(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Input
            label="Interest rate (%)"
            inputMode="decimal"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
          />
          <Select
            aria-label="Interest rate per"
            value={rateUnit}
            onChange={(e) => {
              const unit = e.target.value as 'month' | 'year';
              // Keep the same rate, shown the new way.
              if (rateNumber) setRateInput(String(unit === 'year' ? Number((rateNumber * 12).toFixed(4)) : Number((rateNumber / 12).toFixed(4))));
              setRateUnit(unit);
            }}
          >
            <option value="month">a month</option>
            <option value="year">a year</option>
          </Select>
        </div>
        <Select label="Charged" value={method} onChange={(e) => setMethod(e.target.value as 'reducing' | 'flat')}>
          <option value="reducing">On what’s left</option>
          <option value="flat">Flat, on the full amount</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Processing fee"
          inputMode="decimal"
          placeholder="None"
          value={feeInput}
          onChange={(e) => setFeeInput(e.target.value)}
        />
        <Select label="First instalment" value={first} onChange={(e) => setFirst(e.target.value)}>
          {[...new Set([...firstChoices, first])].sort().map((d) => (
            <option key={d} value={d}>
              {shortDate(d)} statement
            </option>
          ))}
        </Select>
      </div>

      {terms && schedule.length > 0 && (
        <p className="text-xs text-slate-400">
          <span className="font-medium text-slate-200">{money(instalmentAmount(terms))} a month</span>
          {totalInterest > 0 ? ` · ${money(totalInterest)} interest in all` : ' · no interest'}
          {fee ? ` · ${money(fee)} fee on the first statement` : ''}.
          {totalInterest > 0 && (upfront ? ' All the interest goes on the card at the start.' : ' Each statement adds its interest to the card.')}
        </p>
      )}
      {rateNumber > 0 && (
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={upfront}
            disabled={!!plan}
            onChange={(e) => setUpfrontChoice(e.target.checked)}
          />
          <span>
            <span className="text-slate-200">The bank adds all the interest at the start.</span>{' '}
            {plan
              ? 'To change this, remove the plan and start it again.'
              : 'Tick it if the statement’s deal amount already includes the interest (the instalment × the months).'}
          </span>
        </label>
      )}
      {principal != null && principal > amount && (
        <p className="text-xs text-danger">More than the entry itself ({money(amount)}).</p>
      )}
      {pastCharges && (
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" className="mt-0.5" checked={addPast} onChange={(e) => setAddPast(e.target.checked)} />
          <span>
            Also add the {[upfrontCharged || (!upfront && pastStatements.some((i) => i.interest > 0)) ? 'interest' : '', pastFee ? 'fee' : '']
              .filter(Boolean)
              .join(' and ')}{' '}
            the bank has already charged. Leave it off if it’s in Copper already (say, your card’s balance matches the
            statement).
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {plan ? (
          <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
            Remove plan
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !valid}>
            {plan ? 'Save plan' : 'Start plan'}
          </Button>
        </div>
      </div>
      {plan && (
        <p className="text-[11px] text-slate-500">Interest already added to the card stays when the plan changes or is removed.</p>
      )}
    </div>
  );
}

function SettleForm({ plan, currency, onDone }: { plan: CardPlanInfo; currency: string; onDone: () => void }) {
  const db = useDB();
  const [on, setOn] = useState(toDateString());
  const [chargeInput, setChargeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const charge = chargeInput ? parseAmount(chargeInput, currency) : 0;
  const left = unbilledAfter(plan, plan.statement_day, on);
  const settle = async () => {
    setBusy(true);
    try {
      await settleCardPlan(db, plan, on, charge ?? 0);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        The next statement bills what’s left —{' '}
        <span className="font-medium text-slate-200">{formatMoney(left, currency)}</span> — with no more interest.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <DateField label="Settled on" value={on} onChange={setOn} />
        <Input
          label="Settlement charge"
          inputMode="decimal"
          placeholder="None"
          value={chargeInput}
          onChange={(e) => setChargeInput(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={settle} disabled={busy || charge == null}>
          Settle
        </Button>
      </div>
    </div>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDB } from '@/db/DBProvider';
import type { DB } from '@/db/wasm';
import { getSetting, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { detectDefaultCurrency } from '@/lib/locale';
import { toDateString } from '@/lib/dates';
import {
  BUILTIN_PER_USD,
  parseFxRates,
  convert,
  resolveRates,
  type FxRate,
  type FxRates,
  type TransferRateRow,
} from '@/lib/fx';
import { useQuery } from '@/db/useQuery';

interface AppSettingsContextValue {
  onboarded: boolean;
  defaultCurrency: string;
  /** Each currency's rate against the default — typed, from a transfer, or built in. */
  fxRates: FxRates;
  /** The same rates with where each came from, for explaining converted figures. */
  rateInfo: Record<string, FxRate>;
  /** Only the rates typed in Settings. */
  manualRates: FxRates;
  setOnboarded: (v: boolean) => Promise<void>;
  setDefaultCurrency: (code: string) => Promise<void>;
  /** Type a rate for a currency, or pass null to go back to the automatic one. */
  setFxRate: (code: string, rate: number | null) => Promise<void>;
  refresh: () => Promise<void>;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const db = useDB();
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboardedState] = useState(false);
  const [defaultCurrency, setDefaultCurrencyState] = useState<string>('USD');
  const [manualRates, setManualRates] = useState<FxRates>({});

  const refresh = useCallback(async () => {
    const [flag, cur, rates] = await Promise.all([
      getSetting(db, SETTINGS_KEYS.ONBOARDED),
      getSetting(db, SETTINGS_KEYS.DEFAULT_CURRENCY),
      getSetting(db, SETTINGS_KEYS.FX_RATES),
    ]);
    setOnboardedState(flag === 'true');
    // Settings live on each device; a device that joined someone's book never
    // picked a currency. Use the book's own before guessing from the browser
    // (an en-US browser in Dubai would otherwise label dirhams as dollars).
    setDefaultCurrencyState(cur || (await bookCurrency(db)) || detectDefaultCurrency());
    setManualRates(parseFxRates(rates));
  }, [db]);

  // With no currency chosen here, the book's currency can change as its
  // accounts arrive (a first sync), so follow it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = db.onUpdate((_type, _dbName, tblName) => {
      if (tblName !== 'accounts' || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void getSetting(db, SETTINGS_KEYS.DEFAULT_CURRENCY).then((cur) => {
          if (!cur) void refresh();
        });
      }, 200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [db, refresh]);

  useEffect(() => {
    let cancelled = false;
    refresh().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as {
        __resetOnboarding?: () => Promise<void>;
        __markOnboarded?: () => Promise<void>;
      };
      w.__resetOnboarding = async () => {
        await setSetting(db, SETTINGS_KEYS.ONBOARDED, 'false');
        await setSetting(db, SETTINGS_KEYS.DEFAULT_CURRENCY, '');
        location.reload();
      };
      w.__markOnboarded = async () => {
        await setSetting(db, SETTINGS_KEYS.ONBOARDED, 'true');
        location.reload();
      };
    }
  }, [db]);

  const setOnboarded = useCallback(
    async (v: boolean) => {
      await setSetting(db, SETTINGS_KEYS.ONBOARDED, v ? 'true' : 'false');
      setOnboardedState(v);
    },
    [db],
  );

  const setDefaultCurrency = useCallback(
    async (code: string) => {
      await setSetting(db, SETTINGS_KEYS.DEFAULT_CURRENCY, code);
      setDefaultCurrencyState(code);
    },
    [db],
  );

  const setFxRate = useCallback(
    async (code: string, rate: number | null) => {
      const next = { ...manualRates };
      if (rate == null) delete next[code];
      else next[code] = rate;
      await setSetting(db, SETTINGS_KEYS.FX_RATES, JSON.stringify(next));
      setManualRates(next);
    },
    [db, manualRates],
  );

  // The person's own cross-currency transfers, newest first: the rate their bank
  // actually gave them is the best guess for converting that currency.
  const transferRows = useQuery<TransferRateRow[]>(
    useCallback(
      (d) =>
        d.execO<TransferRateRow>(
          `SELECT t1.occurred_on AS date, a1.currency AS fromCurrency, ABS(t1.amount_minor) AS fromMinor,
                  a2.currency AS toCurrency, ABS(t2.amount_minor) AS toMinor
           FROM transactions t1
           JOIN transactions t2 ON t2.id = t1.transfer_peer_id
           JOIN accounts a1 ON a1.id = t1.account_id
           JOIN accounts a2 ON a2.id = t2.account_id
           WHERE t1.kind = 'transfer' AND t1.amount_minor < 0 AND a1.currency <> a2.currency
             AND t1.occurred_on <= ?
           ORDER BY t1.occurred_on DESC, t1.created_at DESC
           LIMIT 500`,
          [toDateString()],
        ),
      [],
    ),
    { deps: ['transactions', 'accounts'] },
  ).data;

  const rateInfo = useMemo(
    () =>
      resolveRates(
        defaultCurrency,
        [...Object.keys(BUILTIN_PER_USD), ...Object.keys(manualRates)],
        manualRates,
        transferRows ?? [],
      ),
    [defaultCurrency, manualRates, transferRows],
  );
  // Keep the same object while the numbers are unchanged: screens re-query
  // whenever fxRates changes, and an unrelated edit re-runs the transfer query.
  const ratesRef = useRef<FxRates>({});
  const fxRates = useMemo(() => {
    const next: FxRates = {};
    for (const [code, r] of Object.entries(rateInfo)) next[code] = r.rate;
    if (JSON.stringify(next) !== JSON.stringify(ratesRef.current)) ratesRef.current = next;
    return ratesRef.current;
  }, [rateInfo]);

  if (!ready) return null;

  return (
    <AppSettingsContext.Provider
      value={{
        onboarded,
        defaultCurrency,
        fxRates,
        rateInfo,
        manualRates,
        setOnboarded,
        setDefaultCurrency,
        setFxRate,
        refresh,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettings must be used inside <AppSettingsProvider>');
  return ctx;
}

export function useDefaultCurrency(): string {
  return useAppSettings().defaultCurrency;
}

/**
 * Returns a converter that folds any currency into the default (or an explicit
 * target). Closes over the current default currency and manual FX rates, so
 * call sites just do `toDefault(minor, account.currency)`.
 */
export function useConvert(): (amountMinor: number, from: string, to?: string) => number {
  const { defaultCurrency, fxRates } = useAppSettings();
  return useCallback(
    (amountMinor: number, from: string, to: string = defaultCurrency) =>
      convert(amountMinor, from, to, defaultCurrency, fxRates),
    [defaultCurrency, fxRates],
  );
}

/** The main account's currency, else the one most accounts use; null for an empty book. */
async function bookCurrency(db: DB): Promise<string | null> {
  const rows = await db.execO<{ currency: string }>(
    `SELECT currency FROM accounts WHERE archived_at IS NULL
     GROUP BY currency ORDER BY MAX(is_main) DESC, COUNT(*) DESC LIMIT 1`,
  );
  return rows[0]?.currency ?? null;
}

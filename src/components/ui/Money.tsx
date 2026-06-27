import { formatMoneyParts } from '@/lib/money';

interface MoneyProps {
  minor: number;
  currency: string;
  signed?: boolean;
  withSymbol?: boolean;
  className?: string;
  fractionClassName?: string;
}

export function Money({
  minor,
  currency,
  signed,
  withSymbol,
  className,
  fractionClassName = 'text-[0.65em] opacity-60',
}: MoneyProps) {
  const { sign, symbol, integer, separator, fraction } = formatMoneyParts(minor, currency, {
    signed,
    withSymbol,
  });
  return (
    <span className={className}>
      {sign}
      {symbol}
      {integer}
      {fraction && (
        <span className={fractionClassName}>
          {separator}
          {fraction}
        </span>
      )}
    </span>
  );
}

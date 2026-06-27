import { Coins, Landmark, CreditCard, Wallet, Users, Circle } from 'lucide-react';
import type { AccountType } from '@/db/types';

const ICONS: Record<AccountType, typeof Coins> = {
  cash: Coins,
  bank: Landmark,
  credit_card: CreditCard,
  wallet: Wallet,
  loan: Users,
  other: Circle,
};

export function AccountTypeIcon({ type, className }: { type: AccountType; className?: string }) {
  const Icon = ICONS[type] ?? Circle;
  return <Icon className={className} />;
}

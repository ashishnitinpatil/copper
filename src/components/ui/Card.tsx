import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/40 p-5 ${className}`}>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Placeholder rows while a list loads, so the page says it's working instead of sitting blank. */
export function LoadingRows({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="space-y-2 motion-safe:animate-pulse">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 rounded-xl bg-slate-800/50" />
      ))}
    </div>
  );
}

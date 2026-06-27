import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const FIELD_BASE =
  'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-60';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, className = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? rest.name ?? autoId;
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}
      <input ref={ref} id={fieldId} className={`${FIELD_BASE} ${className}`} {...rest} />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, className = '', id, children, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? rest.name ?? autoId;
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}
      <select ref={ref} id={fieldId} className={`${FIELD_BASE} ${className}`} {...rest}>
        {children}
      </select>
    </div>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, className = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? rest.name ?? autoId;
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}
      <textarea ref={ref} id={fieldId} rows={3} className={`${FIELD_BASE} ${className}`} {...rest} />
    </div>
  );
});

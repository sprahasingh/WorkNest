import type { ReactNode } from "react";

export const inputStyles =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-900 dark:disabled:text-slate-500";

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

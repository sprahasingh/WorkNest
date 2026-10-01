import { useState, type InputHTMLAttributes } from "react";
import { inputControlStyles } from "./Field";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput({
  className = "",
  ...props
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative mt-1">
      <input
        {...props}
        type={isVisible ? "text" : "password"}
        className={`${inputControlStyles} pr-16 ${className}`.trim()}
      />
      <button
        type="button"
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute right-2 top-1/2 inline-flex min-h-8 -translate-y-1/2 items-center gap-1 rounded px-2 text-xs font-medium text-slate-500 transition-colors hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-slate-400 dark:hover:text-teal-300"
      >
        {isVisible ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c5 0 8.3 4.5 9 7-.3 1.1-1.1 2.5-2.3 3.7" />
            <path d="M6.2 6.2C4.3 7.4 3.3 9.5 3 12c.7 2.5 4 7 9 7 1.1 0 2.1-.2 3-.6" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M3 12c.7-2.5 4-7 9-7s8.3 4.5 9 7c-.7 2.5-4 7-9 7s-8.3-4.5-9-7Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        )}
        <span>{isVisible ? "Hide" : "Show"}</span>
      </button>
    </div>
  );
}

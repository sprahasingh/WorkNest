import type { ReactNode } from "react";
import { Link } from "react-router";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen bg-white">
      <div className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-teal-600 to-teal-800 p-12 text-white lg:flex">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white">
            W
          </span>
          WorkNest
        </Link>

        <div className="max-w-sm">
          <p className="text-2xl font-semibold leading-snug">
            &ldquo;Real tenant isolation and role-based access, without
            building it yourself.&rdquo;
          </p>
          <p className="mt-4 text-sm text-teal-100">
            Every organization&apos;s data is scoped at the database layer,
            and every action is enforced by role, on the server, every time.
          </p>
        </div>

        <p className="text-xs text-teal-100">
          &copy; {new Date().getFullYear()} WorkNest
        </p>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center bg-slate-50 px-4 py-12 lg:bg-white">
        <Link
          to="/"
          className="absolute left-4 top-4 flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-teal-700 sm:left-6 sm:top-6"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to home
        </Link>

        <Link
          to="/"
          className="mb-8 flex items-center gap-2 text-lg font-bold text-slate-800 lg:hidden"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white">
            W
          </span>
          WorkNest
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}

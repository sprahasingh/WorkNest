import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-600 text-lg font-bold text-white">
        W
      </span>
      <h1 className="text-4xl font-bold text-slate-900">404</h1>
      <p className="max-w-sm text-slate-600">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link
        to="/"
        className="mt-2 text-sm font-medium text-teal-700 hover:underline"
      >
        Back to home
      </Link>
    </div>
  );
}

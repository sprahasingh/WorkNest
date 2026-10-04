import { Link } from "react-router";
import { BrandLink } from "@/components/BrandLink";
import { useAuth } from "@/auth/auth-context";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";

export function NotFound() {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center dark:bg-slate-950">
      <BrandLink />
      <h1 className="mt-4 text-5xl font-bold text-slate-900 dark:text-slate-50">
        404
      </h1>
      <p className="max-w-sm text-slate-600 dark:text-slate-400">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        {signedIn && (
          <Link
            to={resolvePostAuthPath(auth.memberships ?? [])}
            className="inline-flex items-center justify-center rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Go to your workspace
          </Link>
        )}
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

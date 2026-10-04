import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./auth-context";

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 dark:bg-slate-950">
        <p className="text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    // Keep where they were headed (a link from an email or a notification),
    // so signing in lands there instead of on the default page.
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}

import { Navigate, Outlet } from "react-router";
import { useAuth } from "./auth-context";

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 dark:bg-slate-950">
        <p className="text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

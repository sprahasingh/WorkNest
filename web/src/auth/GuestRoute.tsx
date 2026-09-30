import { Navigate, Outlet, useLocation } from "react-router";
import { resolvePostAuthPath, safeNextPath } from "@/lib/postAuthRedirect";
import { useAuth } from "./auth-context";

// Login and register are for signed-out visitors; send anyone already signed
// in straight to their workspace.
export function GuestRoute() {
  const { status, memberships } = useAuth();
  const location = useLocation();

  if (status === "authenticated") {
    return (
      <Navigate
        to={
          safeNextPath(location.search) ??
          resolvePostAuthPath(memberships ?? [])
        }
        replace
      />
    );
  }

  return <Outlet />;
}

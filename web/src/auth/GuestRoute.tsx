import { Navigate, Outlet } from "react-router";
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";
import { useAuth } from "./auth-context";

// Login and register are for signed-out visitors; send anyone already signed
// in straight to their workspace.
export function GuestRoute() {
  const { status, memberships } = useAuth();

  if (status === "authenticated") {
    return <Navigate to={resolvePostAuthPath(memberships ?? [])} replace />;
  }

  return <Outlet />;
}

import { useEffect, useState } from "react";
import { Navigate, Outlet, useParams } from "react-router";
import { setOrgAccessHandler } from "@/api/client";
import { useAuth } from "./auth-context";
import { OrgContext, type OrgContextValue } from "@/hooks/useOrg";
import { NotFound } from "@/pages/NotFound";
import { rememberLastOrg } from "@/lib/postAuthRedirect";

export function OrgRoute() {
  const { orgId } = useParams<{ orgId: string }>();
  const { memberships, refreshMemberships } = useAuth();
  // Set when the server says we lost access to this org while using it.
  const [lostOrgName, setLostOrgName] = useState<string | null>(null);

  const membership = memberships?.find((m) => m.tenantId.id === orgId);
  const orgName = membership?.tenantId.name ?? null;

  // If an admin removes you or changes your role while you're here, pick up
  // the change instead of leaving the app half-broken.
  useEffect(() => {
    setOrgAccessHandler((changedOrgId, change) => {
      if (changedOrgId !== orgId) return;
      if (change === "lost") setLostOrgName(orgName);
      void refreshMemberships();
    });
    return () => setOrgAccessHandler(null);
  }, [orgId, orgName, refreshMemberships]);

  const currentOrgId = membership?.tenantId.id;
  useEffect(() => {
    if (currentOrgId) rememberLastOrg(currentOrgId);
  }, [currentOrgId]);

  if (!orgId || !membership) {
    if (lostOrgName) {
      return (
        <Navigate to="/orgs" replace state={{ lostOrgName: lostOrgName }} />
      );
    }
    return <NotFound />;
  }

  const value: OrgContextValue = {
    orgId: membership.tenantId.id,
    orgName: membership.tenantId.name,
    role: membership.role,
  };

  return (
    <OrgContext.Provider value={value}>
      <Outlet />
    </OrgContext.Provider>
  );
}

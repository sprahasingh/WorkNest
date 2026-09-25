import { Outlet, useParams } from "react-router";
import { useAuth } from "./auth-context";
import { OrgContext, type OrgContextValue } from "@/hooks/useOrg";
import { NotFound } from "@/pages/NotFound";

export function OrgRoute() {
  const { orgId } = useParams<{ orgId: string }>();
  const { memberships } = useAuth();

  const membership = memberships?.find((m) => m.tenantId.id === orgId);

  if (!orgId || !membership) {
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

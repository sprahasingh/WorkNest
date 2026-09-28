import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "./api";

export const dashboardKeys = {
  detail: (orgId: string) => ["orgs", orgId, "dashboard"] as const,
};

export function useDashboard(orgId: string) {
  return useQuery({
    queryKey: dashboardKeys.detail(orgId),
    queryFn: () => getDashboard(orgId),
  });
}

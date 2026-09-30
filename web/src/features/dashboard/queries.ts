import { useQuery } from "@tanstack/react-query";
import { getDashboard, type DashboardRange } from "./api";

export const dashboardKeys = {
  all: (orgId: string) => ["orgs", orgId, "dashboard"] as const,
  detail: (orgId: string, days: DashboardRange = 14) =>
    ["orgs", orgId, "dashboard", days] as const,
};

export function useDashboard(orgId: string, days: DashboardRange = 14) {
  return useQuery({
    queryKey: dashboardKeys.detail(orgId, days),
    queryFn: () => getDashboard(orgId, days),
  });
}

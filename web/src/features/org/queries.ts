import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Plan } from "@/api/auth";
import { dashboardKeys } from "@/features/dashboard/queries";
import { changePlan, getOrg, updateOrg, type UpdateOrgInput } from "./api";

export const orgKeys = {
  detail: (orgId: string) => ["orgs", orgId, "detail"] as const,
};

export function useOrgDetails(orgId: string) {
  return useQuery({
    queryKey: orgKeys.detail(orgId),
    queryFn: () => getOrg(orgId),
  });
}

export function useUpdateOrg(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateOrgInput) => updateOrg(orgId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
    },
  });
}

export function useChangePlan(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (plan: Plan) => changePlan(orgId, plan),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.detail(orgId),
      });
    },
  });
}

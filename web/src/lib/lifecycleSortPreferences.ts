import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { useAuth } from "@/auth/auth-context";
import type { LifecycleSort, LifecycleView } from "./lifecycleSorting";

export type LifecycleSortPreferences = Partial<
  Record<LifecycleView, LifecycleSort>
>;

export const lifecycleSortPreferenceKeys = {
  context: (orgId: string, userId: string, context: string) =>
    ["orgs", orgId, "users", userId, "lifecycle-sort", context] as const,
};

async function getPreferences(
  orgId: string,
  context: string,
): Promise<LifecycleSortPreferences> {
  const response = await apiClient.get<{
    preferences: LifecycleSortPreferences;
  }>(`/orgs/${orgId}/preferences/lifecycle-sort`, { params: { context } });
  return response.data.preferences;
}

async function putPreference(input: {
  orgId: string;
  context: string;
  view: LifecycleView;
  sort: LifecycleSort;
}): Promise<void> {
  await apiClient.put(`/orgs/${input.orgId}/preferences/lifecycle-sort`, {
    context: input.context,
    view: input.view,
    sort: input.sort,
  });
}

export function useLifecycleSortPreferences(
  orgId: string,
  context: string,
  enabled = true,
) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  return useQuery({
    queryKey: lifecycleSortPreferenceKeys.context(orgId, userId, context),
    queryFn: () => getPreferences(orgId, context),
    enabled: enabled && !!orgId && !!context && !!userId,
    staleTime: 60_000,
  });
}

export function useSaveLifecycleSortPreference(orgId: string, context: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = lifecycleSortPreferenceKeys.context(
    orgId,
    user?.id ?? "",
    context,
  );
  return useMutation({
    mutationFn: (value: { view: LifecycleView; sort: LifecycleSort }) =>
      putPreference({ orgId, context, ...value }),
    onMutate: async ({ view, sort }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<LifecycleSortPreferences>(queryKey);
      queryClient.setQueryData<LifecycleSortPreferences>(queryKey, {
        ...previous,
        [view]: sort,
      });
      return { previous };
    },
    onError: (_error, _value, contextValue) => {
      if (contextValue?.previous) {
        queryClient.setQueryData(queryKey, contextValue.previous);
      } else {
        queryClient.removeQueries({ queryKey, exact: true });
      }
    },
  });
}

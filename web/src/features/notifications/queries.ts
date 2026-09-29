import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUnreadNotifications, markNotificationsRead } from "./api";

export const notificationKeys = {
  unread: (orgId: string) =>
    ["orgs", orgId, "notifications", "unread"] as const,
};

export function useUnreadNotifications(orgId: string) {
  return useQuery({
    queryKey: notificationKeys.unread(orgId),
    queryFn: () => getUnreadNotifications(orgId),
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationsRead(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(orgId, ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.unread(orgId),
      });
    },
  });
}

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  dismissNotifications,
  isTaskReminder,
  markNotificationsRead,
  type NotificationStatus,
} from "./api";

const POLL_INTERVAL_MS = 30_000;

export const notificationKeys = {
  all: (orgId: string) => ["orgs", orgId, "notifications"] as const,
  list: (orgId: string, status: NotificationStatus) =>
    [...notificationKeys.all(orgId), status] as const,
};

export function useNotifications(
  orgId: string,
  status: NotificationStatus,
  enabled = true,
) {
  return useQuery({
    queryKey: notificationKeys.list(orgId, status),
    queryFn: () => listNotifications(orgId, status),
    refetchInterval: POLL_INTERVAL_MS,
    enabled,
  });
}

export function useUnreadCount(orgId: string): number {
  return useNotifications(orgId, "unread").data?.unreadCount ?? 0;
}

export function useMarkNotificationsRead(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(orgId, ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.all(orgId),
      });
    },
  });
}

export function useDismissNotifications(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => dismissNotifications(orgId, ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.all(orgId),
      });
    },
  });
}

export type ViewedTarget =
  { kind: "task"; taskId: string } | { kind: "project"; projectId: string };

// Opening the thing a notification is about counts as reading it.
export function useMarkReadWhenViewed(
  orgId: string,
  target: ViewedTarget | null,
) {
  const { data } = useNotifications(orgId, "unread", target !== null);
  const { mutate } = useMarkNotificationsRead(orgId);

  const targetKind = target?.kind;
  const targetId = target?.kind === "task" ? target.taskId : target?.projectId;

  useEffect(() => {
    if (!targetKind || !targetId || !data) return;
    const ids = data.notifications
      .filter(
        (n) =>
          !isTaskReminder(n.type) &&
          (targetKind === "task"
            ? n.taskId === targetId
            : n.projectId === targetId && n.taskId === null),
      )
      .map((n) => n._id);
    if (ids.length > 0) mutate(ids);
  }, [data, targetKind, targetId, mutate]);
}

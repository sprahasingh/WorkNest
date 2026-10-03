import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMutes,
  setMute,
  type MuteTarget,
  type Mutes,
  listNotifications,
  dismissNotifications,
  isReminder,
  markNotificationsRead,
  type NotificationList,
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

// Dismissed notifications leave the list straight away; they come back if
// the server says no.
export function useDismissNotifications(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => dismissNotifications(orgId, ids),
    onMutate: async (ids) => {
      const key = notificationKeys.all(orgId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueriesData<NotificationList>({
        queryKey: key,
      });
      queryClient.setQueriesData<NotificationList>(
        { queryKey: key },
        (current) => {
          if (!current) return current;
          const removed = current.notifications.filter((item) =>
            ids.includes(item._id),
          );
          const wasUnread = removed.filter(
            (item) => !item.readAt && !item.dismissedAt,
          );
          return {
            ...current,
            notifications: current.notifications.filter(
              (item) => !ids.includes(item._id),
            ),
            unreadCount: Math.max(0, current.unreadCount - wasUnread.length),
            readableUnreadCount: Math.max(
              0,
              current.readableUnreadCount -
                wasUnread.filter((item) => !isReminder(item.type)).length,
            ),
          };
        },
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
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
          !isReminder(n.type) &&
          (targetKind === "task"
            ? n.taskId === targetId
            : n.projectId === targetId && n.taskId === null),
      )
      .map((n) => n._id);
    if (ids.length > 0) mutate(ids);
  }, [data, targetKind, targetId, mutate]);
}

const mutesKey = (orgId: string) => ["orgs", orgId, "mutes"] as const;

export function useMutes(orgId: string) {
  return useQuery({
    queryKey: mutesKey(orgId),
    queryFn: () => getMutes(orgId),
    staleTime: 60_000,
  });
}

export function useSetMute(orgId: string) {
  const queryClient = useQueryClient();
  const key = mutesKey(orgId);

  return useMutation({
    mutationFn: (input: { target: MuteTarget; muted: boolean }) =>
      setMute(orgId, input.target, input.muted),
    // The switch flips at once; it flips back if saving fails.
    onMutate: async ({ target, muted }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Mutes>(key);
      const toggle = (ids: string[], id: string) =>
        muted ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
      queryClient.setQueryData<Mutes>(key, (current) => {
        const base = current ?? { projectIds: [], taskIds: [] };
        return "projectId" in target
          ? { ...base, projectIds: toggle(base.projectIds, target.projectId) }
          : { ...base, taskIds: toggle(base.taskIds, target.taskId) };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (mutes) => {
      queryClient.setQueryData(key, mutes);
    },
  });
}

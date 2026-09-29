import { apiClient } from "@/api/client";
import type { ActivityType } from "@/features/tasks/api";

export interface Notification {
  _id: string;
  userId: string;
  tenantId: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  activityId: string;
  type: ActivityType | null;
  actorId: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export type NotificationStatus = "unread" | "all";

export interface NotificationList {
  notifications: Notification[];
  unreadCount: number;
}

export async function listNotifications(
  orgId: string,
  status: NotificationStatus,
): Promise<NotificationList> {
  const response = await apiClient.get<NotificationList>(
    `/orgs/${orgId}/notifications`,
    { params: { status } },
  );
  return response.data;
}

export async function markNotificationsRead(
  orgId: string,
  ids?: string[],
): Promise<void> {
  await apiClient.patch(`/orgs/${orgId}/notifications/read`, { ids });
}

// Where a notification takes you: the task's updates, or the project's.
export function notificationLink(
  orgId: string,
  notification: Notification,
): string | null {
  if (!notification.projectId) return null;
  const query = notification.taskId
    ? `task=${notification.taskId}`
    : "updates=1";
  return `/orgs/${orgId}/projects/${notification.projectId}?${query}`;
}

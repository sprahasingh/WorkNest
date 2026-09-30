import { apiClient } from "@/api/client";
import type { ActivityType, TaskNotificationType } from "@/features/tasks/api";

export type NotificationType = ActivityType | TaskNotificationType;
export const TASK_REMINDER_TYPES: TaskNotificationType[] = [
  "task_due_soon",
  "task_overdue",
];

export interface Notification {
  _id: string;
  userId: string;
  tenantId: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  dueDate: string | null;
  activityId: string | null;
  type: NotificationType | null;
  actorId: string | null;
  message: string;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export type NotificationStatus = "unread" | "all";

export interface NotificationList {
  notifications: Notification[];
  unreadCount: number;
  readableUnreadCount: number;
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

export async function dismissNotifications(
  orgId: string,
  ids: string[],
): Promise<void> {
  await apiClient.patch(`/orgs/${orgId}/notifications/dismiss`, { ids });
}

export function isTaskReminder(type: NotificationType | null): boolean {
  return TASK_REMINDER_TYPES.includes(type as TaskNotificationType);
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

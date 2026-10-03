import { apiClient } from "@/api/client";
import type { ActivityType, TaskNotificationType } from "@/features/tasks/api";

export type ProjectNotificationType = "project_due_soon" | "project_overdue";
export type ReminderNotificationType =
  TaskNotificationType | ProjectNotificationType;
export type NotificationType = ActivityType | ReminderNotificationType;
export const TASK_REMINDER_TYPES: TaskNotificationType[] = [
  "task_due_soon",
  "task_overdue",
];
export const PROJECT_REMINDER_TYPES: ProjectNotificationType[] = [
  "project_due_soon",
  "project_overdue",
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

export function isReminder(type: NotificationType | null): boolean {
  return (
    TASK_REMINDER_TYPES.includes(type as TaskNotificationType) ||
    PROJECT_REMINDER_TYPES.includes(type as ProjectNotificationType)
  );
}

// Where a notification takes you: the task's updates, or the project's,
// scrolled to the message it's about.
export function notificationLink(
  orgId: string,
  notification: Notification,
): string | null {
  if (!notification.projectId) return null;
  const params = new URLSearchParams();
  if (notification.taskId) params.set("task", notification.taskId);
  else if (!isReminder(notification.type)) params.set("updates", "1");
  if (notification.activityId) params.set("message", notification.activityId);
  const query = params.toString();
  return `/orgs/${orgId}/projects/${notification.projectId}${query ? `?${query}` : ""}`;
}

// Projects and tasks the signed-in person has muted. Muting stops general
// chatter from them; anything addressed to the person still arrives.
export interface Mutes {
  projectIds: string[];
  taskIds: string[];
}

export async function getMutes(orgId: string): Promise<Mutes> {
  const response = await apiClient.get<Mutes>(
    `/orgs/${orgId}/notifications/mutes`,
  );
  return response.data;
}

export type MuteTarget = { projectId: string } | { taskId: string };

export async function setMute(
  orgId: string,
  target: MuteTarget,
  muted: boolean,
): Promise<Mutes> {
  const response = await apiClient.put<Mutes>(
    `/orgs/${orgId}/notifications/mutes`,
    { ...target, muted },
  );
  return response.data;
}

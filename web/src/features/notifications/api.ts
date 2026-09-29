import { apiClient } from "@/api/client";

export interface Notification {
  _id: string;
  userId: string;
  tenantId: string;
  projectId: string | null;
  taskId: string | null;
  activityId: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export async function getUnreadNotifications(
  orgId: string,
): Promise<Notification[]> {
  const response = await apiClient.get<{ notifications: Notification[] }>(
    `/orgs/${orgId}/notifications`,
  );
  return response.data.notifications;
}

export async function markNotificationsRead(
  orgId: string,
  ids?: string[],
): Promise<void> {
  await apiClient.patch(`/orgs/${orgId}/notifications/read`, { ids });
}

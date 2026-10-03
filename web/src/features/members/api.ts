import { apiClient } from "@/api/client";
import type { Role } from "@/api/auth";

export interface Member {
  _id: string;
  tenantId: string;
  userId: {
    id: string;
    name: string;
    email: string;
  };
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export async function listMembers(orgId: string): Promise<Member[]> {
  const response = await apiClient.get<{ members: Member[] }>(
    `/orgs/${orgId}/members`,
  );
  return response.data.members;
}

export async function changeMemberRole(
  orgId: string,
  memberId: string,
  role: Role,
): Promise<void> {
  await apiClient.patch(`/orgs/${orgId}/members/${memberId}`, { role });
}

// What to do with the meetings someone organizes when they go.
export type MeetingChoice =
  { action: "cancel" } | { action: "handover"; userId: string };

export async function removeMember(
  orgId: string,
  memberId: string,
  meetings?: MeetingChoice,
): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/members/${memberId}`, {
    data: meetings ? { meetings } : undefined,
  });
}

export interface MeetingImpact {
  organizedUpcoming: number;
  organizedUpcomingSeries: number;
  // Only sent to the person themselves; admins just get the count.
  meetings?: { id: string; title: string; startsAt: string }[];
}

export async function getMeetingImpact(
  orgId: string,
  memberId: string,
): Promise<MeetingImpact> {
  const response = await apiClient.get<MeetingImpact>(
    `/orgs/${orgId}/members/${memberId}/meeting-impact`,
  );
  return response.data;
}

import { apiClient } from "@/api/client";
import type { Role } from "@/api/auth";

export type InviteStatus =
  "pending" | "accepted" | "declined" | "revoked" | "expired";

export interface Invite {
  _id: string;
  tenantId: string;
  email: string;
  role: Role;
  invitedBy: string;
  expiresAt: string;
  status: InviteStatus;
  createdAt: string;
  updatedAt: string;
  // Whether this email already has a WorkNest account (then the invite also
  // shows up in their app).
  existingUser?: boolean;
}

export interface CreateInviteInput {
  email: string;
  role: Role;
  // Replace a pending invite for the same email with a fresh link.
  replaceExisting?: boolean;
}

export interface CreateInviteResponse {
  invite: Invite;
  existingUser: boolean;
  emailSent: boolean;
  inviteUrl?: string;
}

export async function listInvites(orgId: string): Promise<Invite[]> {
  const response = await apiClient.get<{ invites: Invite[] }>(
    `/orgs/${orgId}/invites`,
  );
  return response.data.invites;
}

export async function createInvite(
  orgId: string,
  input: CreateInviteInput,
): Promise<CreateInviteResponse> {
  const response = await apiClient.post<CreateInviteResponse>(
    `/orgs/${orgId}/invites`,
    input,
  );
  return response.data;
}

export async function revokeInvite(
  orgId: string,
  inviteId: string,
): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/invites/${inviteId}`);
}

import { apiClient } from "./client";
import type { Role } from "./auth";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitePreview {
  organizationName: string;
  email: string;
  role: Role;
  expired: boolean;
  status: InviteStatus;
}

export interface AcceptedMembership {
  _id: string;
  tenantId: string;
  userId: string;
  role: Role;
}

export interface AcceptInviteResponse {
  membership: AcceptedMembership;
}

export interface InviteSignupInput {
  name: string;
  password: string;
}

export interface InviteSignupResponse {
  accessToken: string;
}

export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const response = await apiClient.get<InvitePreview>(`/invites/${token}`);
  return response.data;
}

export async function acceptInvite(
  token: string,
): Promise<AcceptInviteResponse> {
  const response = await apiClient.post<AcceptInviteResponse>(
    `/invites/${token}/accept`,
  );
  return response.data;
}

export async function signupViaInvite(
  token: string,
  input: InviteSignupInput,
): Promise<InviteSignupResponse> {
  const response = await apiClient.post<InviteSignupResponse>(
    `/invites/${token}/signup`,
    input,
  );
  return response.data;
}

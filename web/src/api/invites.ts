import { apiClient } from "./client";
import type { Role } from "./auth";

export type InviteStatus =
  "pending" | "accepted" | "declined" | "revoked" | "expired";

export interface InvitePreview {
  organizationName: string;
  email: string;
  role: Role;
  expired: boolean;
  status: InviteStatus;
  // Whether this email already has a WorkNest account.
  accountExists: boolean;
}

// An invitation addressed to the signed-in user, from any organization.
export interface MyInvite {
  _id: string;
  organization: { id: string; name: string };
  role: Role;
  invitedBy: { name: string } | null;
  createdAt: string;
  expiresAt: string;
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

// When the invite was emailed, the account is ready at once (accessToken);
// otherwise a verification email goes out first.
export type InviteSignupResponse =
  | { verificationRequired: false; accessToken: string }
  | { verificationRequired: true; email: string };

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

export async function listMyInvites(): Promise<MyInvite[]> {
  const response = await apiClient.get<{ invites: MyInvite[] }>("/me/invites");
  return response.data.invites;
}

export async function acceptMyInvite(
  inviteId: string,
): Promise<AcceptInviteResponse> {
  const response = await apiClient.post<AcceptInviteResponse>(
    `/me/invites/${inviteId}/accept`,
  );
  return response.data;
}

export async function declineMyInvite(inviteId: string): Promise<void> {
  await apiClient.post(`/me/invites/${inviteId}/decline`);
}

export async function declineInvite(token: string): Promise<void> {
  await apiClient.post(`/invites/${token}/decline`);
}

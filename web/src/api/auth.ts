import { apiClient } from "./client";

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export interface AuthRequestOptions {
  signal?: AbortSignal;
}

export type Role = "admin" | "manager" | "member";
export type Plan = "free" | "pro" | "premium";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  orgName: string;
}

export type RegisterResponse =
  | { verificationRequired: true; email: string }
  | { verificationRequired: false; accessToken: string };

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface AuthTokenResponse {
  accessToken: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt?: string | null;
  pendingEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
}

export interface OrgMembership {
  _id: string;
  tenantId: OrganizationSummary;
  userId: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface MeResponse {
  user: User;
  memberships: OrgMembership[];
}

export interface UpdatePersonalInformationInput {
  name: string;
  currentPassword: string;
  newPassword?: string;
}

export interface RequestEmailChangeInput {
  email: string;
  currentPassword: string;
}

export async function updatePersonalInformation(
  input: UpdatePersonalInformationInput,
): Promise<User> {
  const response = await apiClient.patch<{ user: User }>("/auth/me", input);
  return response.data.user;
}

export async function requestEmailChange(
  input: RequestEmailChangeInput,
): Promise<User> {
  const response = await apiClient.post<{ user: User }>(
    "/auth/me/email-change",
    input,
  );
  return response.data.user;
}

export async function cancelEmailChange(): Promise<User> {
  const response = await apiClient.delete<{ user: User }>(
    "/auth/me/email-change",
  );
  return response.data.user;
}

export async function verifyEmailChange(token: string): Promise<User> {
  const response = await apiClient.post<{ user: User }>(
    "/auth/verify-email-change",
    { token },
  );
  return response.data.user;
}

export async function register(
  input: RegisterInput,
): Promise<RegisterResponse> {
  const response = await apiClient.post<RegisterResponse>(
    "/auth/register",
    input,
  );
  return response.data;
}

export async function verifyRegistration(
  token: string,
): Promise<AuthTokenResponse> {
  const response = await apiClient.post<AuthTokenResponse>(
    "/auth/verify-registration",
    { token },
  );
  return response.data;
}

export async function login(
  input: LoginInput,
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  const response = await apiClient.post<AuthTokenResponse>(
    "/auth/login",
    input,
    { timeout: AUTH_REQUEST_TIMEOUT_MS, signal: options.signal },
  );
  return response.data;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiClient.post("/auth/forgot-password", { email });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  await apiClient.post("/auth/reset-password", { token, password });
}

export async function refresh(): Promise<AuthTokenResponse> {
  const response = await apiClient.post<AuthTokenResponse>("/auth/refresh");
  return response.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function fetchMe(
  options: AuthRequestOptions = {},
): Promise<MeResponse> {
  const response = await apiClient.get<MeResponse>("/auth/me", {
    timeout: AUTH_REQUEST_TIMEOUT_MS,
    signal: options.signal,
  });
  return response.data;
}

export async function deleteAccount(): Promise<void> {
  await apiClient.delete("/auth/me");
}

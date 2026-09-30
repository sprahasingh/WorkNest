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

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokenResponse {
  accessToken: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
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

export async function register(
  input: RegisterInput,
): Promise<AuthTokenResponse> {
  const response = await apiClient.post<AuthTokenResponse>(
    "/auth/register",
    input,
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

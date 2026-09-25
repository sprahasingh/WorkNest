import { apiClient } from "./client";

export type Role = "admin" | "manager" | "member";
export type Plan = "free" | "pro";

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

export async function login(input: LoginInput): Promise<AuthTokenResponse> {
  const response = await apiClient.post<AuthTokenResponse>(
    "/auth/login",
    input,
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

export async function fetchMe(): Promise<MeResponse> {
  const response = await apiClient.get<MeResponse>("/auth/me");
  return response.data;
}

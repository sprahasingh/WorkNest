import { apiClient } from "@/api/client";
import type { Plan } from "@/api/auth";

// How much of the plan is in use. overLimit means the account is locked.
export interface PlanUsage {
  seatsUsed: number;
  seatLimit: number;
  projectCount: number;
  projectLimit: number;
  projectsOverTaskLimit: number;
  activeTaskLimit: number | null;
  overLimit: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  plan: Plan;
  // When a paid plan ends; null when it doesn't.
  planExpiresAt: string | null;
  // Set when a paid plan ran out and the account went back to Free.
  planExpiredAt: string | null;
  planExpiredFrom: Plan | null;
  usage?: PlanUsage;
  seatLimit: number;
  seatsUsed: number;
  projectLimit: number;
  projectCount: number;
  adminCount: number;
  // Days chat messages are kept; null keeps them for good.
  chatRetentionDays: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateOrgInput {
  name?: string;
  timeZone?: string;
  // With a new time zone: keep date-only due dates on the same calendar day
  // (true, the default) or leave them exactly as stored (false).
  moveDueDates?: boolean;
  chatRetentionDays?: 90 | 180 | 365 | null;
}

export async function getOrg(orgId: string): Promise<Organization> {
  const response = await apiClient.get<{
    organization: Omit<Organization, "usage">;
    usage: PlanUsage;
  }>(`/orgs/${orgId}`);
  return { ...response.data.organization, usage: response.data.usage };
}

export async function updateOrg(
  orgId: string,
  input: UpdateOrgInput,
): Promise<Organization> {
  const response = await apiClient.patch<{ organization: Organization }>(
    `/orgs/${orgId}`,
    input,
  );
  return response.data.organization;
}

export async function changePlan(
  orgId: string,
  plan: Plan,
): Promise<Organization> {
  const response = await apiClient.post<{ organization: Organization }>(
    `/orgs/${orgId}/plan`,
    { plan },
  );
  return response.data.organization;
}

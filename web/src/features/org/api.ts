import { apiClient } from "@/api/client";
import type { Plan } from "@/api/auth";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  seatLimit: number;
  seatsUsed: number;
  projectLimit: number;
  projectCount: number;
  adminCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateOrgInput {
  name: string;
}

export async function getOrg(orgId: string): Promise<Organization> {
  const response = await apiClient.get<{ organization: Organization }>(
    `/orgs/${orgId}`,
  );
  return response.data.organization;
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

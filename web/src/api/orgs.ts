import { apiClient } from "./client";
import type { Plan } from "./auth";

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

export interface CreateOrgInput {
  name: string;
}

export interface CreateOrgResponse {
  organization: Organization;
}

export async function createOrg(
  input: CreateOrgInput,
): Promise<CreateOrgResponse> {
  const response = await apiClient.post<CreateOrgResponse>("/orgs", input);
  return response.data;
}

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

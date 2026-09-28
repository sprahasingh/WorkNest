import { apiClient } from "@/api/client";

export interface StatusCount {
  _id: string;
  count: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface TopAssignee {
  userId: string;
  name: string;
  email: string;
  openTaskCount: number;
}

export interface DashboardUsage {
  seatsUsed: number;
  seatLimit: number;
  memberCount: number;
  projectCount: number;
  projectLimit: number;
}

export interface DashboardData {
  tasksByStatus: StatusCount[];
  tasksByPriority: StatusCount[];
  tasksCreatedPerDay: DailyCount[];
  topAssignees: TopAssignee[];
  overdueCount: number;
  usage: DashboardUsage;
}

export async function getDashboard(orgId: string): Promise<DashboardData> {
  const response = await apiClient.get<DashboardData>(
    `/orgs/${orgId}/dashboard`,
  );
  return response.data;
}

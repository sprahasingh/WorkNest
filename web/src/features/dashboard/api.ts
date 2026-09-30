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

// A number of days, or everything since the org started.
export type DashboardRange = number | "all";

export interface DashboardTrend {
  // How points are grouped; long "all time" spans use weeks or months.
  granularity: "day" | "week" | "month";
  // First day of the range, YYYY-MM-DD.
  since: string;
  total: number;
}

export interface DashboardData {
  tasksByStatus: StatusCount[];
  tasksByPriority: StatusCount[];
  // One point per day, week, or month (see trend.granularity), dated by its
  // first day.
  tasksCreatedPerDay: DailyCount[];
  trend: DashboardTrend;
  topAssignees: TopAssignee[];
  overdueCount: number;
  usage: DashboardUsage;
}

export async function getDashboard(
  orgId: string,
  days: DashboardRange = 14,
): Promise<DashboardData> {
  const response = await apiClient.get<DashboardData>(
    `/orgs/${orgId}/dashboard`,
    { params: { days } },
  );
  return response.data;
}

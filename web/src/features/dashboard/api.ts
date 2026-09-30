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
  // First day of the range, YYYY-MM-DD, in the viewer's time zone.
  since: string;
  // Today in that time zone; the last point is still in progress.
  today: string;
  timeZone: string;
  total: number;
  // Tasks created in the equally long period before; null for all time.
  previousTotal: number | null;
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
    // Days are counted in the viewer's own time zone.
    {
      params: {
        days,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  );
  return response.data;
}

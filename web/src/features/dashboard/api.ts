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

// A number of days, everything since the org started, or a custom span of
// calendar days ("YYYY-MM-DD", both ends included).
export type DashboardRange = number | "all" | { from: string; to: string };

export interface DashboardTrend {
  // How points are grouped; long "all time" spans use weeks or months.
  granularity: "day" | "week" | "month";
  // First and last day of the range, YYYY-MM-DD, in the viewer's time zone.
  since: string;
  until: string;
  // Today in that time zone; the last point is still in progress.
  today: string;
  timeZone: string;
  total: number;
  // Tasks created in the equally long period before; null for all time.
  previousTotal: number | null;
}

// One point on the trend: tasks waiting in To do and In progress at its
// end, and how many were marked done during it.
export interface StatusPoint {
  date: string;
  todo: number;
  in_progress: number;
  done: number;
}

export interface WorkloadEntry {
  userId: string;
  name: string;
  todo: number;
  inProgress: number;
}

export interface ProjectProgress {
  projectId: string;
  name: string;
  key: string;
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  open: number;
  overdue: number;
  // Tasks created and marked done in the chosen range.
  createdInRange: number;
  completedInRange: number;
  // When the last task was finished, if every task is done; and whether
  // that happened in the chosen range.
  finishedAt: string | null;
  finishedInRange: boolean;
}

export interface DashboardData {
  tasksByStatus: StatusCount[];
  tasksByPriority: StatusCount[];
  // One point per day, week, or month (see trend.granularity), dated by its
  // first day.
  tasksCreatedPerDay: DailyCount[];
  trend: DashboardTrend;
  // Same points as tasksCreatedPerDay.
  statusHistory: StatusPoint[];
  // Times tasks were marked done in the range, and in the equally long
  // period before (null for all time).
  completed: { total: number; previousTotal: number | null };
  // Tasks not done yet, by priority.
  openByPriority: StatusCount[];
  // People with open work, busiest first.
  workload: WorkloadEntry[];
  unassignedOpenCount: number;
  // Active projects, most open work first.
  projectProgress: ProjectProgress[];
  archivedProjectCount: number;
  // Open tasks due in the next 7 days (not counting overdue ones).
  dueSoonCount: number;
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
        ...(typeof days === "object" ? days : { days }),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  );
  return response.data;
}

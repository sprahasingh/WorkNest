import type { ReactElement } from "react";
import { Navigate } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { Card } from "@/components/ui/Card";
import { useDashboard } from "./queries";
import type { StatusCount } from "./api";

const STATUS_ORDER = ["todo", "in_progress", "done"];
const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const PRIORITY_ORDER = ["low", "medium", "high"];
const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function normalizeCounts(
  counts: StatusCount[],
  order: string[],
  labels: Record<string, string>,
): { name: string; count: number }[] {
  const byId = new Map(counts.map((entry) => [entry._id, entry.count]));
  return order.map((key) => ({
    name: labels[key] ?? key,
    count: byId.get(key) ?? 0,
  }));
}

function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${month}/${day}`;
}

export function DashboardPage() {
  const { orgId } = useOrg();
  const canViewDashboard = useCan("dashboard:read");
  const { data, isPending, isError } = useDashboard(orgId);

  if (!canViewDashboard) {
    return <Navigate to={`/orgs/${orgId}/projects`} replace />;
  }

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl bg-slate-200"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
        <p className="mx-auto max-w-5xl text-sm text-red-600">
          Couldn&apos;t load the dashboard.
        </p>
      </div>
    );
  }

  const statusData = normalizeCounts(
    data.tasksByStatus,
    STATUS_ORDER,
    STATUS_LABELS,
  );
  const priorityData = normalizeCounts(
    data.tasksByPriority,
    PRIORITY_ORDER,
    PRIORITY_LABELS,
  );
  const trendData = data.tasksCreatedPerDay.map((entry) => ({
    date: formatShortDate(entry.date),
    count: entry.count,
  }));

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Overdue tasks" value={data.overdueCount} />
          <StatCard
            label="Members"
            value={`${data.usage.memberCount}`}
            sub={`${data.usage.seatsUsed} / ${data.usage.seatLimit} seats`}
          />
          <StatCard
            label="Projects"
            value={`${data.usage.projectCount} / ${data.usage.projectLimit}`}
          />
          <StatCard
            label="Tasks created (14d)"
            value={trendData.reduce((sum, entry) => sum + entry.count, 0)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ChartCard title="Tasks by status">
            <BarChart data={statusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Tasks by priority">
            <BarChart data={priorityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#134e4a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>

        <ChartCard title="Tasks created, last 14 days">
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#0d9488"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartCard>

        <Card>
          <h2 className="font-medium text-slate-800">Top assignees</h2>
          {data.topAssignees.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No open tasks are assigned yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.topAssignees.map((assignee) => (
                <li
                  key={assignee.userId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-700">
                    {assignee.name}{" "}
                    <span className="text-slate-400">{assignee.email}</span>
                  </span>
                  <span className="font-medium text-slate-800">
                    {assignee.openTaskCount} open
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </Card>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactElement;
}) {
  return (
    <Card>
      <h2 className="font-medium text-slate-800">{title}</h2>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

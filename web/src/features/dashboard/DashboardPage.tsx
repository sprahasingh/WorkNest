import { useState, type ReactElement } from "react";
import { Link, Navigate } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useTheme } from "@/theme/theme-context";
import { Card } from "@/components/ui/Card";
import { useDashboard } from "./queries";
import type { StatusCount } from "./api";

const DATE_RANGE_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
] as const;

const STATUS_ORDER = ["todo", "in_progress", "done"];
const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
const STATUS_COLORS: Record<string, string> = {
  todo: "#94a3b8",
  in_progress: "#f59e0b",
  done: "#10b981",
};

const PRIORITY_ORDER = ["low", "medium", "high"];
const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
const PRIORITY_COLORS: Record<string, string> = {
  low: "#94a3b8",
  medium: "#f59e0b",
  high: "#ef4444",
};

function normalizeCounts(
  counts: StatusCount[],
  order: string[],
  labels: Record<string, string>,
): { key: string; name: string; count: number }[] {
  const byId = new Map(counts.map((entry) => [entry._id, entry.count]));
  return order.map((key) => ({
    key,
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
  const [days, setDays] = useState(14);
  const { data, isPending, isError } = useDashboard(orgId, days);

  if (!canViewDashboard) {
    return <Navigate to={`/orgs/${orgId}/projects`} replace />;
  }

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <p className="mx-auto max-w-5xl text-sm text-red-600 dark:text-red-400">
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

  const isNewOrg = data.usage.projectCount === 0;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Last {opt.label}
              </option>
            ))}
          </select>
        </div>

        {isNewOrg && (
          <GettingStarted
            orgId={orgId}
            hasMultipleMembers={data.usage.memberCount > 1}
          />
        )}

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
            label={`Tasks created (${days}d)`}
            value={trendData.reduce((sum, entry) => sum + entry.count, 0)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ChartCard title="Tasks by status">
            {({ gridColor, tickColor, tooltipStyle }) => (
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: tickColor }} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: tickColor }}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {statusData.map((entry) => (
                    <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ChartCard>

          <ChartCard title="Tasks by priority">
            {({ gridColor, tickColor, tooltipStyle }) => (
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: tickColor }} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: tickColor }}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {priorityData.map((entry) => (
                    <Cell key={entry.key} fill={PRIORITY_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ChartCard>
        </div>

        <ChartCard title={`Tasks created, last ${days} days`}>
          {({ gridColor, tickColor, tooltipStyle }) => (
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickColor }} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: tickColor }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#14b8a6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          )}
        </ChartCard>

        <Card>
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            Top assignees
          </h2>
          {data.topAssignees.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No open tasks are assigned yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.topAssignees.map((assignee) => (
                <li
                  key={assignee.userId}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-700 dark:text-slate-300">
                    {assignee.name}{" "}
                    <span className="text-slate-400">{assignee.email}</span>
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">
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
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {sub}
        </p>
      )}
    </Card>
  );
}

interface ChartTheme {
  gridColor: string;
  tickColor: string;
  tooltipStyle: {
    background: string;
    border: string;
    borderRadius: number;
    color: string;
    fontSize: number;
  };
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: (chartTheme: ChartTheme) => ReactElement;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const chartTheme: ChartTheme = {
    gridColor: isDark ? "#334155" : "#e2e8f0",
    tickColor: isDark ? "#94a3b8" : "#64748b",
    tooltipStyle: {
      background: isDark ? "#1e293b" : "#ffffff",
      border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
      borderRadius: 8,
      color: isDark ? "#f1f5f9" : "#0f172a",
      fontSize: 13,
    },
  };

  return (
    <Card>
      <h2 className="font-medium text-slate-800 dark:text-slate-100">
        {title}
      </h2>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          {children(chartTheme)}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function GettingStarted({
  orgId,
  hasMultipleMembers,
}: {
  orgId: string;
  hasMultipleMembers: boolean;
}) {
  const steps = [
    {
      done: false,
      title: "Create a project",
      description: "Projects group related tasks together.",
      to: `/orgs/${orgId}/projects`,
      cta: "Create project",
    },
    {
      done: hasMultipleMembers,
      title: "Invite your team",
      description: "Add teammates and assign them a role.",
      to: `/orgs/${orgId}/members`,
      cta: "Invite people",
    },
    {
      done: false,
      title: "Create a task",
      description: "Open a project to add your first task.",
      to: `/orgs/${orgId}/projects`,
      cta: "Go to projects",
    },
  ];

  return (
    <Card className="border-teal-100 bg-teal-50/40 dark:border-teal-900/40 dark:bg-teal-950/20">
      <h2 className="font-semibold text-slate-800 dark:text-slate-100">
        Getting started with{" "}
        <span className="text-teal-700 dark:text-teal-400">WorkNest</span>
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        A few steps to get your workspace up and running.
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <span
                className={
                  step.done
                    ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white"
                    : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                }
              >
                {step.done ? "✓" : index + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {step.title}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {step.description}
                </p>
              </div>
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className="shrink-0 self-start rounded-lg border border-teal-200 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/40 sm:self-auto"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

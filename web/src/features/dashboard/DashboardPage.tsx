import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from "react";
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
import type { DashboardRange, DashboardTrend, StatusCount } from "./api";

const DATE_RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
  { value: "all", label: "All time" },
];

// Two taps or clicks this close together (ms) count as a double tap.
const DOUBLE_TAP_MS = 350;

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

function formatUtcDate(
  isoDate: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

const FULL_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

// Axis tick and tooltip heading for one trend point.
function trendLabels(
  isoDate: string,
  granularity: DashboardTrend["granularity"],
): { tick: string; full: string } {
  if (granularity === "month") {
    return {
      tick: formatUtcDate(isoDate, { month: "short", year: "2-digit" }),
      full: formatUtcDate(isoDate, { month: "long", year: "numeric" }),
    };
  }
  const full = formatUtcDate(isoDate, FULL_DATE);
  return {
    tick: formatShortDate(isoDate),
    full: granularity === "week" ? `Week of ${full}` : full,
  };
}

function trendTitle(range: DashboardRange, trend: DashboardTrend): string {
  if (range !== "all") return `Tasks created, last ${range} days`;
  const per = { day: "per day", week: "per week", month: "per month" }[
    trend.granularity
  ];
  return `Tasks created ${per}, since ${formatUtcDate(trend.since, FULL_DATE)}`;
}

export function DashboardPage() {
  const { orgId } = useOrg();
  const canViewDashboard = useCan("dashboard:read");
  const [days, setDays] = useState<DashboardRange>(14);
  const { data, isPending, isError } = useDashboard(orgId, days);

  if (!canViewDashboard) {
    return <Navigate to={`/orgs/${orgId}/projects`} replace />;
  }

  if (isPending) {
    return (
      <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
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
      <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
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
  const trendData = data.tasksCreatedPerDay.map((entry) => {
    const labels = trendLabels(entry.date, data.trend.granularity);
    return { date: labels.tick, fullLabel: labels.full, count: entry.count };
  });

  const isNewOrg = data.usage.projectCount === 0;

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <select
            value={String(days)}
            aria-label="Date range"
            onChange={(e) =>
              setDays(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label}
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
            label={
              days === "all"
                ? "Tasks created (all time)"
                : `Tasks created (${days}d)`
            }
            value={data.trend.total}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ChartCard title="Tasks by status" subtitle="All tasks right now">
            {({ gridColor, tickColor, tooltipProps }) => (
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: tickColor }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: tickColor }}
                />
                <Tooltip {...tooltipProps} formatter={taskCountFormatter} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {statusData.map((entry) => (
                    <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ChartCard>

          <ChartCard title="Tasks by priority" subtitle="All tasks right now">
            {({ gridColor, tickColor, tooltipProps }) => (
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: tickColor }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: tickColor }}
                />
                <Tooltip {...tooltipProps} formatter={taskCountFormatter} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {priorityData.map((entry) => (
                    <Cell key={entry.key} fill={PRIORITY_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ChartCard>
        </div>

        <ChartCard title={trendTitle(days, data.trend)}>
          {({ gridColor, tickColor, tooltipProps }) => (
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickColor }} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: tickColor }}
              />
              <Tooltip
                {...tooltipProps}
                formatter={taskCountFormatter}
                labelFormatter={(label, payload) =>
                  (payload?.[0]?.payload as { fullLabel?: string } | undefined)
                    ?.fullLabel ?? label
                }
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#14b8a6"
                strokeWidth={2}
                // Few points (e.g. a new org's "all time") read better as dots.
                dot={trendData.length <= 14 ? { r: 3 } : false}
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
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{sub}</p>
      )}
    </Card>
  );
}

function taskCountFormatter(value: unknown): [string, string] {
  return [String(value), "Tasks"];
}

interface ChartTheme {
  gridColor: string;
  tickColor: string;
  // Spread onto <Tooltip>: its look, and whether it may show at all.
  tooltipProps: {
    active?: boolean;
    contentStyle: {
      background: string;
      border: string;
      borderRadius: number;
      color: string;
      fontSize: number;
    };
  };
}

// Exact numbers stay hidden until the chart is double-tapped (or
// double-clicked), so an ordinary tap or scroll doesn't pop them up.
function useDoubleTapDetails() {
  const [showDetails, setShowDetails] = useState(false);
  const lastTapRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // A tap anywhere else hides them again.
  useEffect(() => {
    if (!showDetails) return;
    const hideOnOutsideTap = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowDetails(false);
      }
    };
    document.addEventListener("pointerdown", hideOnOutsideTap);
    return () => document.removeEventListener("pointerdown", hideOnOutsideTap);
  }, [showDetails]);

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.timeStamp - lastTapRef.current < DOUBLE_TAP_MS) {
      setShowDetails((shown) => !shown);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = event.timeStamp;
    }
  };

  // With a mouse, moving off the chart hides them too.
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") setShowDetails(false);
  };

  return { showDetails, containerRef, onPointerUp, onPointerLeave };
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: (chartTheme: ChartTheme) => ReactElement;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { showDetails, containerRef, onPointerUp, onPointerLeave } =
    useDoubleTapDetails();
  const chartTheme: ChartTheme = {
    gridColor: isDark ? "#334155" : "#e2e8f0",
    tickColor: isDark ? "#94a3b8" : "#64748b",
    tooltipProps: {
      // false keeps it hidden; undefined lets it follow the pointer.
      active: showDetails ? undefined : false,
      contentStyle: {
        background: isDark ? "#1e293b" : "#ffffff",
        border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
        borderRadius: 8,
        color: isDark ? "#f1f5f9" : "#0f172a",
        fontSize: 13,
      },
    },
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="font-medium text-slate-800 dark:text-slate-100">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
        <p
          className="text-xs text-slate-400 dark:text-slate-500"
          aria-live="polite"
        >
          <span className="pointer-coarse:hidden">
            {showDetails
              ? "Double-click to hide numbers"
              : "Double-click for numbers"}
          </span>
          <span className="hidden pointer-coarse:inline">
            {showDetails
              ? "Double-tap to hide numbers"
              : "Double-tap for numbers"}
          </span>
        </p>
      </div>
      <div
        ref={containerRef}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        data-details={showDetails ? "on" : "off"}
        // manipulation stops a double tap from zooming the page on phones;
        // no outline, so a tap doesn't leave a focus box around the chart.
        className="mt-4 h-56 touch-manipulation select-none [&_*]:outline-none"
      >
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

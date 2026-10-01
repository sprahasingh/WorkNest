import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link, Navigate } from "react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useTheme } from "@/theme/theme-context";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useDashboard } from "./queries";
import type { DashboardRange, DashboardTrend, StatusCount } from "./api";

const DATE_RANGE_OPTIONS: { value: number | "all"; label: string }[] = [
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

const PERIOD_WORDS = {
  day: { per: "per day", current: "today" },
  week: { per: "per week", current: "this week" },
  month: { per: "per month", current: "this month" },
} as const;

// Axis tick and tooltip heading for one trend point. The last point is the
// current day, week or month, which is still filling up.
function trendLabels(
  isoDate: string,
  granularity: DashboardTrend["granularity"],
  isCurrent: boolean,
): { tick: string; full: string } {
  const soFar = isCurrent
    ? ` (${PERIOD_WORDS[granularity].current}, so far)`
    : "";
  if (granularity === "month") {
    return {
      tick: formatUtcDate(isoDate, { month: "short", year: "2-digit" }),
      full: `${formatUtcDate(isoDate, { month: "long", year: "numeric" })}${soFar}`,
    };
  }
  const full = formatUtcDate(isoDate, FULL_DATE);
  return {
    // "Sep 28" rather than "09/28", which reads differently by country.
    tick: formatUtcDate(isoDate, { month: "short", day: "numeric" }),
    full: `${granularity === "week" ? `Week of ${full}` : full}${soFar}`,
  };
}

function formatAverage(value: number): string {
  // 2.97 -> "3", 2.46 -> "2.5", 12.4 -> "12".
  return value >= 10
    ? String(Math.round(value))
    : String(Math.round(value * 10) / 10);
}

// How many days the range covers, both ends included.
function rangeLength(trend: DashboardTrend): number {
  return (
    Math.round(
      (Date.parse(trend.until) - Date.parse(trend.since)) / 86_400_000,
    ) + 1
  );
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// "+5 vs previous 14 days": the difference in tasks created, or null when
// there's nothing to compare.
function trendChange(
  range: DashboardRange,
  trend: DashboardTrend,
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (range === "all" || trend.previousTotal === null) return null;
  // Nothing in either period: the chart already says so.
  if (trend.previousTotal === 0 && trend.total === 0) return null;
  const length = typeof range === "number" ? range : rangeLength(trend);
  const versus = `vs previous ${length} ${length === 1 ? "day" : "days"}`;
  const difference = trend.total - trend.previousTotal;
  if (difference === 0)
    return { text: `No change ${versus}`, direction: "flat" };
  return {
    text: `${difference > 0 ? "+" : "−"}${Math.abs(difference)} ${versus}`,
    direction: difference > 0 ? "up" : "down",
  };
}

function trendTitle(range: DashboardRange, trend: DashboardTrend): string {
  if (typeof range === "number") return `Tasks created, last ${range} days`;
  if (typeof range === "object") {
    const sameYear = trend.since.slice(0, 4) === trend.until.slice(0, 4);
    const from = formatUtcDate(
      trend.since,
      sameYear ? { month: "short", day: "numeric" } : FULL_DATE,
    );
    return trend.since === trend.until
      ? `Tasks created on ${formatUtcDate(trend.since, FULL_DATE)}`
      : `Tasks created, ${from} to ${formatUtcDate(trend.until, FULL_DATE)}`;
  }
  const per = { day: "per day", week: "per week", month: "per month" }[
    trend.granularity
  ];
  return `Tasks created ${per}, since ${formatUtcDate(trend.since, FULL_DATE)}`;
}

export function DashboardPage() {
  const { orgId } = useOrg();
  const canViewDashboard = useCan("dashboard:read");
  const [days, setDays] = useState<DashboardRange>(14);
  // The custom dates being picked, before they're applied.
  const [customDraft, setCustomDraft] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const todayKey = localDayKey(new Date());
  const { data, isPending, isError, isPlaceholderData } = useDashboard(
    orgId,
    days,
  );

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
  const trendData = data.tasksCreatedPerDay.map((entry, index, all) => {
    const labels = trendLabels(
      entry.date,
      data.trend.granularity,
      // Only the last point, and only if the range runs up to today.
      index === all.length - 1 && data.trend.until === data.trend.today,
    );
    return { date: labels.tick, fullLabel: labels.full, count: entry.count };
  });
  const trendAverage =
    trendData.length > 0 ? data.trend.total / trendData.length : 0;
  const change = trendChange(days, data.trend);
  const per = PERIOD_WORDS[data.trend.granularity].per;
  const isUpdating = isPlaceholderData;

  const isNewOrg = data.usage.projectCount === 0;

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <div className="flex items-center gap-3">
            {isUpdating && (
              <span
                role="status"
                className="text-xs text-slate-500 dark:text-slate-400"
              >
                Updating…
              </span>
            )}
            <select
              value={
                customDraft || typeof days === "object"
                  ? "custom"
                  : String(days)
              }
              aria-label="Date range"
              onChange={(e) => {
                const value = e.target.value;
                if (value === "custom") {
                  const start = new Date();
                  start.setDate(start.getDate() - 13);
                  setCustomDraft(
                    typeof days === "object"
                      ? days
                      : { from: localDayKey(start), to: todayKey },
                  );
                  return;
                }
                setCustomDraft(null);
                setDays(value === "all" ? "all" : Number(value));
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {DATE_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
            {typeof days === "object" && !customDraft && (
              <button
                type="button"
                onClick={() => setCustomDraft(days)}
                className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                Change dates
              </button>
            )}
          </div>
        </div>

        {customDraft && (
          <CustomRangePicker
            draft={customDraft}
            today={todayKey}
            onChange={setCustomDraft}
            onApply={() => {
              setDays(customDraft);
              setCustomDraft(null);
            }}
            onCancel={() => setCustomDraft(null)}
          />
        )}

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
            label="Active projects"
            value={`${data.usage.projectCount} / ${data.usage.projectLimit}`}
          />
          <StatCard
            label={
              days === "all"
                ? "Tasks created (all time)"
                : `Tasks created (${typeof days === "number" ? days : rangeLength(data.trend)}d)`
            }
            value={data.trend.total}
            sub={change?.text}
          />
        </div>

        <div
          className={cn(
            "space-y-6 transition-opacity",
            isUpdating && "opacity-60",
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ChartCard
              title="Tasks by status"
              subtitle="All tasks right now"
              emptyMessage={
                statusData.every((d) => d.count === 0)
                  ? "No tasks yet"
                  : undefined
              }
              description={statusData
                .map((d) => `${d.name}: ${d.count}`)
                .join(", ")}
            >
              {({ gridColor, tickColor, tooltipProps }) => (
                <BarChart data={statusData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridColor}
                    vertical={false}
                  />
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

            <ChartCard
              title="Tasks by priority"
              subtitle="All tasks right now"
              emptyMessage={
                priorityData.every((d) => d.count === 0)
                  ? "No tasks yet"
                  : undefined
              }
              description={priorityData
                .map((d) => `${d.name}: ${d.count}`)
                .join(", ")}
            >
              {({ gridColor, tickColor, tooltipProps }) => (
                <BarChart data={priorityData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridColor}
                    vertical={false}
                  />
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

          <ChartCard
            title={trendTitle(days, data.trend)}
            summary={
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {data.trend.total}
                </span>
                {change && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      change.direction === "up" &&
                        "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                      change.direction === "down" &&
                        "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      change.direction === "flat" &&
                        "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                    )}
                  >
                    {change.direction === "up" && "▲ "}
                    {change.direction === "down" && "▼ "}
                    {change.text}
                  </span>
                )}
                {data.trend.total > 0 && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Avg {formatAverage(trendAverage)} {per}
                  </span>
                )}
              </div>
            }
            emptyMessage={
              data.trend.total === 0
                ? "No tasks were created in this period"
                : undefined
            }
            description={`${data.trend.total} tasks created. ${change?.text ?? ""} Average ${formatAverage(trendAverage)} ${per}.`}
          >
            {({ gridColor, tickColor, tooltipProps }) => (
              <AreaChart
                data={trendData}
                margin={{ top: 8, right: 8, left: -8 }}
              >
                <defs>
                  <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={gridColor}
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: tickColor }}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: tickColor }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  {...tooltipProps}
                  formatter={taskCountFormatter}
                  labelFormatter={(label, payload) =>
                    (
                      payload?.[0]?.payload as
                        { fullLabel?: string } | undefined
                    )?.fullLabel ?? label
                  }
                />
                {data.trend.total > 0 && (
                  <ReferenceLine
                    y={trendAverage}
                    stroke={tickColor}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    ifOverflow="extendDomain"
                  />
                )}
                <Area
                  // Monotone keeps the curve from dipping below zero or
                  // overshooting between points.
                  type="monotone"
                  dataKey="count"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  fill="url(#trend-fill)"
                  // Few points (e.g. a new org's "all time") read better as dots.
                  dot={trendData.length <= 14 ? { r: 3 } : false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            )}
          </ChartCard>
        </div>

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
    separator: string;
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
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    pointerId: number;
  } | null>(null);
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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      pointerId: event.pointerId,
    };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (
      !start ||
      start.pointerId !== event.pointerId ||
      event.timeStamp - start.time > 300 ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
    ) {
      return;
    }

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

  const onPointerCancel = () => {
    pointerStartRef.current = null;
  };

  return {
    showDetails,
    containerRef,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  };
}

function ChartCard({
  title,
  subtitle,
  summary,
  emptyMessage,
  description,
  children,
}: {
  title: string;
  subtitle?: string;
  // Headline numbers shown between the title and the chart.
  summary?: ReactNode;
  // Shown over the chart when there's no data to plot.
  emptyMessage?: string;
  // Text version of the chart for screen readers.
  description?: string;
  children: (chartTheme: ChartTheme) => ReactElement;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const {
    showDetails,
    containerRef,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  } = useDoubleTapDetails();
  const chartTheme: ChartTheme = {
    gridColor: isDark ? "#334155" : "#e2e8f0",
    tickColor: isDark ? "#94a3b8" : "#64748b",
    tooltipProps: {
      // false keeps it hidden; undefined lets it follow the pointer.
      active: showDetails ? undefined : false,
      separator: ": ",
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
      {summary && <div className="mt-3">{summary}</div>}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        data-details={showDetails ? "on" : "off"}
        // manipulation stops a double tap from zooming the page on phones;
        // no outline, so a tap doesn't leave a focus box around the chart.
        className="relative mt-4 h-56 touch-manipulation select-none [&_*]:outline-none"
        role="img"
        aria-label={description ? `${title}. ${description}` : title}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children(chartTheme)}
        </ResponsiveContainer>
        {emptyMessage && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            <span className="rounded-lg bg-white/90 px-3 py-1.5 shadow-sm dark:bg-slate-900/90">
              {emptyMessage}
            </span>
          </p>
        )}
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

// Two date fields and Apply, shown when "Custom range…" is picked.
function CustomRangePicker({
  draft,
  today,
  onChange,
  onApply,
  onCancel,
}: {
  draft: { from: string; to: string };
  today: string;
  onChange: (draft: { from: string; to: string }) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const error =
    !draft.from || !draft.to
      ? "Pick both dates."
      : draft.from > draft.to
        ? "The start date must be on or before the end date."
        : draft.to > today
          ? "The end date can't be in the future."
          : null;
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:[color-scheme:dark]";

  return (
    <Card className="p-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!error) onApply();
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          From
          <input
            type="date"
            value={draft.from}
            max={draft.to || today}
            onChange={(event) =>
              onChange({ ...draft, from: event.target.value })
            }
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          To
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            max={today}
            onChange={(event) => onChange({ ...draft, to: event.target.value })}
            className={inputClass}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={error !== null}
            className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
        {error && (
          <p className="w-full text-xs text-amber-700 dark:text-amber-300">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}

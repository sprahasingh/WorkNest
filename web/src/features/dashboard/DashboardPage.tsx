import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useTheme } from "@/theme/theme-context";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useDashboard } from "./queries";
import { STATUS_KEYS, projectStage, type StatusKey } from "./chartStyles";
import {
  OpenByPriorityCard,
  ProjectProgressCard,
  StatusDonutCard,
  StatusHistoryCard,
  CreatedVsCompletedCard,
  WorkloadCard,
  WorkspaceCard,
  type FlowRow,
  type StatusHistoryRow,
} from "./DashboardCharts";
import {
  OpenWorkByProjectCard,
  ProjectActivityCard,
  ProjectStageCard,
} from "./ProjectCharts";
import type { DashboardData, DashboardRange, DashboardTrend } from "./api";

const DATE_RANGE_OPTIONS: { value: number | "all"; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
  { value: "all", label: "All time" },
];

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
  return periodChange(range, trend, trend.total, trend.previousTotal);
}

// The same comparison for any count over the range, e.g. tasks completed.
function periodChange(
  range: DashboardRange,
  trend: DashboardTrend,
  total: number,
  previousTotal: number | null,
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (range === "all" || previousTotal === null) return null;
  // Nothing in either period: the chart already says so.
  if (previousTotal === 0 && total === 0) return null;
  const length = typeof range === "number" ? range : rangeLength(trend);
  const versus = `vs previous ${length} ${length === 1 ? "day" : "days"}`;
  const difference = total - previousTotal;
  if (difference === 0)
    return { text: `No change ${versus}`, direction: "flat" };
  return {
    text: `${difference > 0 ? "+" : "−"}${Math.abs(difference)} ${versus}`,
    direction: difference > 0 ? "up" : "down",
  };
}

function trendTitle(range: DashboardRange, trend: DashboardTrend): string {
  if (typeof range === "number")
    return `Created vs completed, last ${range} days`;
  if (typeof range === "object") {
    const sameYear = trend.since.slice(0, 4) === trend.until.slice(0, 4);
    const from = formatUtcDate(
      trend.since,
      sameYear ? { month: "short", day: "numeric" } : FULL_DATE,
    );
    return trend.since === trend.until
      ? `Created vs completed on ${formatUtcDate(trend.since, FULL_DATE)}`
      : `Created vs completed, ${from} to ${formatUtcDate(trend.until, FULL_DATE)}`;
  }
  const per = { day: "per day", week: "per week", month: "per month" }[
    trend.granularity
  ];
  return `Created vs completed ${per}, since ${formatUtcDate(trend.since, FULL_DATE)}`;
}

export function DashboardPage() {
  const { orgId } = useOrg();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // Kept in the address so a refresh or a shared link opens the same view.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: DashboardView =
    searchParams.get("view") === "projects" ? "projects" : "tasks";
  const setView = (next: DashboardView) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === "tasks") params.delete("view");
        else params.set("view", next);
        return params;
      },
      { replace: true },
    );
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

  const statusCounts = Object.fromEntries(
    STATUS_KEYS.map((key) => [
      key,
      data.tasksByStatus.find((entry) => entry._id === key)?.count ?? 0,
    ]),
  ) as Record<StatusKey, number>;
  const trendData = data.tasksCreatedPerDay.map((entry, index, all) => {
    const labels = trendLabels(
      entry.date,
      data.trend.granularity,
      // Only the last point, and only if the range runs up to today.
      index === all.length - 1 && data.trend.until === data.trend.today,
    );
    return { date: labels.tick, fullLabel: labels.full, count: entry.count };
  });
  const points = Math.max(1, trendData.length);
  const createdAverage = data.trend.total / points;
  const completedAverage = data.completed.total / points;
  const change = trendChange(days, data.trend);
  const completedChange = periodChange(
    days,
    data.trend,
    data.completed.total,
    data.completed.previousTotal,
  );
  // Same points and labels as the created trend.
  const statusHistoryRows: StatusHistoryRow[] = data.statusHistory.map(
    (point, index) => ({
      date: trendData[index]?.date ?? point.date,
      fullLabel: trendData[index]?.fullLabel ?? point.date,
      todo: point.todo,
      in_progress: point.in_progress,
    }),
  );
  const flowRows: FlowRow[] = trendData.map((point, index) => ({
    date: point.date,
    fullLabel: point.fullLabel,
    created: point.count,
    completed: data.statusHistory[index]?.done ?? 0,
  }));
  const rangeShort =
    days === "all"
      ? "all time"
      : `${typeof days === "number" ? days : rangeLength(data.trend)}d`;
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
          <div className="flex flex-wrap items-center gap-3">
            <ViewSwitch value={view} onChange={setView} />
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

        <div
          className={cn(
            "@container space-y-6 transition-opacity",
            isUpdating && "opacity-60",
          )}
        >
          {view === "tasks" ? (
            <>
              <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
                <StatCard
                  label="Open tasks"
                  value={statusCounts.todo + statusCounts.in_progress}
                  sub={`${statusCounts.in_progress} in progress`}
                />
                <StatCard
                  label={`Completed (${rangeShort})`}
                  value={data.completed.total}
                  sub={completedChange?.text}
                />
                <StatCard
                  label={`Created (${rangeShort})`}
                  value={data.trend.total}
                  sub={change?.text}
                />
                <StatCard
                  label="Overdue"
                  value={data.overdueCount}
                  warning={
                    data.overdueCount > 0 ? "Needs attention" : undefined
                  }
                  sub={
                    data.dueSoonCount > 0
                      ? `${data.dueSoonCount} more due in 7 days`
                      : "Nothing else due this week"
                  }
                />
              </div>

              <StatusHistoryCard
                rows={statusHistoryRows}
                granularity={data.trend.granularity}
                isDark={isDark}
              />

              {/* Pairs sit side by side only when each chart gets enough room,
              judged by the space the dashboard actually has (the sidebar
              takes some on tablets), so both always switch together. */}
              <div className="grid gap-4 @2xl:grid-cols-2">
                <StatusDonutCard counts={statusCounts} isDark={isDark} />
                <OpenByPriorityCard
                  counts={data.openByPriority}
                  dueSoon={data.dueSoonCount}
                  isDark={isDark}
                />
              </div>

              <CreatedVsCompletedCard
                title={trendTitle(days, data.trend)}
                rows={flowRows}
                created={{ total: data.trend.total, change }}
                completed={{
                  total: data.completed.total,
                  change: completedChange,
                }}
                averageText={
                  data.trend.total + data.completed.total > 0
                    ? `Avg ${formatAverage(createdAverage)} created and ${formatAverage(completedAverage)} completed ${per}`
                    : null
                }
                isDark={isDark}
              />

              <div className="grid gap-4 @2xl:grid-cols-2">
                <WorkloadCard
                  workload={data.workload}
                  unassigned={data.unassignedOpenCount}
                  isDark={isDark}
                />
                <ProjectProgressCard
                  orgId={orgId}
                  projects={data.projectProgress}
                />
              </div>
            </>
          ) : (
            <ProjectsOverview
              orgId={orgId}
              data={data}
              rangeText={rangePhrase(days, data.trend)}
              isDark={isDark}
            />
          )}

          <WorkspaceCard usage={data.usage} />
        </div>
      </div>
    </div>
  );
}

type DashboardView = "tasks" | "projects";

// Switches the whole dashboard between task and project charts.
function ViewSwitch({
  value,
  onChange,
}: {
  value: DashboardView;
  onChange: (value: DashboardView) => void;
}) {
  const options: { value: DashboardView; label: string }[] = [
    { value: "tasks", label: "Tasks" },
    { value: "projects", label: "Projects" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className="inline-flex rounded-lg bg-slate-200 p-1 dark:bg-slate-800"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                onChange(value === "tasks" ? "projects" : "tasks");
              }
            }}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "h-8 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600",
              selected
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// "last 14 days", "all time", "Sep 1 to Sep 20, 2026".
function rangePhrase(range: DashboardRange, trend: DashboardTrend): string {
  if (typeof range === "number") return `last ${range} days`;
  if (range === "all") return "all time";
  if (trend.since === trend.until) {
    return `on ${formatUtcDate(trend.since, FULL_DATE)}`;
  }
  const sameYear = trend.since.slice(0, 4) === trend.until.slice(0, 4);
  return `${formatUtcDate(trend.since, sameYear ? { month: "short", day: "numeric" } : FULL_DATE)} to ${formatUtcDate(trend.until, FULL_DATE)}`;
}

function ProjectsOverview({
  orgId,
  data,
  rangeText,
  isDark,
}: {
  orgId: string;
  data: DashboardData;
  rangeText: string;
  isDark: boolean;
}) {
  const projects = data.projectProgress;
  const stageCount = (stage: ReturnType<typeof projectStage>) =>
    projects.filter((project) => projectStage(project) === stage).length;
  const needAttention = projects.filter((project) => project.overdue > 0);
  const overdueTasks = needAttention.reduce(
    (sum, project) => sum + project.overdue,
    0,
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <StatCard
          label="Active projects"
          value={projects.length}
          sub={`${data.usage.projectCount} of ${data.usage.projectLimit} plan slots used`}
        />
        <StatCard
          label="In progress"
          value={stageCount("inProgress")}
          sub={`${stageCount("notStarted")} not started yet`}
        />
        <StatCard
          label="Completed"
          value={stageCount("completed")}
          sub="Every task done"
        />
        <StatCard
          label="Need attention"
          value={needAttention.length}
          warning={
            needAttention.length > 0
              ? `${overdueTasks} overdue ${overdueTasks === 1 ? "task" : "tasks"}`
              : undefined
          }
          sub={
            needAttention.length > 0
              ? "Projects with overdue tasks"
              : "No overdue tasks"
          }
        />
      </div>

      <div className="grid gap-4 @2xl:grid-cols-2">
        <ProjectStageCard
          projects={projects}
          archivedCount={data.archivedProjectCount}
          isDark={isDark}
        />
        <OpenWorkByProjectCard projects={projects} isDark={isDark} />
      </div>

      <ProjectActivityCard
        projects={projects}
        title={`Created and marked done, ${rangeText}`}
        isDark={isDark}
      />

      <ProjectProgressCard orgId={orgId} projects={projects} limit={10} wide />
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  warning,
}: {
  label: string;
  value: string | number;
  sub?: string;
  // A short status note, shown with an icon so it isn't color alone.
  warning?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
        {value}
      </p>
      {warning && (
        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <span aria-hidden="true">⚠ </span>
          {warning}
        </p>
      )}
      {sub && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      )}
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

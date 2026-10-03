import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { CardTitle, ChartCard } from "./ChartCard";
import {
  CREATED_COLOR,
  STATUS_KEYS,
  STATUS_LABELS,
  statusColors,
  taskCountFormatter,
  type StatusKey,
} from "./chartStyles";
import type {
  DashboardTrend,
  DashboardUsage,
  ProjectProgress,
  StatusCount,
  WorkloadEntry,
} from "./api";

// Matches the priority badges on task cards.
const PRIORITY_ROWS = [
  { key: "high", label: "High", color: "#ef4444" },
  { key: "medium", label: "Medium", color: "#f59e0b" },
  { key: "low", label: "Low", color: "#94a3b8" },
];

const TEXT_INK = { light: "#0f172a", dark: "#f1f5f9" };
const TEXT_MUTED = { light: "#64748b", dark: "#94a3b8" };

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// A short colored key beside text, so identity never rests on color alone.
function SeriesKey({
  color,
  shape = "line",
}: {
  color: string;
  shape?: "line" | "dot" | "bar";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0",
        shape === "line"
          ? "h-[3px] w-3 rounded-full"
          : shape === "bar"
            ? "h-3 w-2 rounded-t-sm"
            : "size-2.5 rounded-full",
      )}
      style={{ backgroundColor: color }}
    />
  );
}

export interface StatusHistoryRow {
  date: string;
  fullLabel: string;
  // Tasks waiting in each status at the end of the day, week or month.
  todo: number;
  in_progress: number;
}

type OpenKey = "todo" | "in_progress";
const OPEN_KEYS: OpenKey[] = ["todo", "in_progress"];

// Show/hide buttons that double as the legend and the latest numbers.
function SeriesToggle<K extends string>({
  label,
  series,
  hidden,
  onToggle,
}: {
  label: string;
  series: {
    key: K;
    name: string;
    color: string;
    shape: "line" | "dot" | "bar";
    value?: number;
    note?: ReactNode;
  }[];
  hidden: K[];
  onToggle: (key: K) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {series.map((item) => {
        const shown = !hidden.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={shown}
            onClick={() => onToggle(item.key)}
            className={cn(
              "flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-1 text-left text-sm transition-colors",
              shown
                ? "border-slate-200 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                : "border-dashed border-slate-300 bg-transparent text-slate-400 dark:border-slate-600 dark:text-slate-500",
            )}
          >
            <SeriesKey
              color={shown ? item.color : "#94a3b8"}
              shape={item.shape}
            />
            {item.name}
            {item.value !== undefined && (
              <span className="font-semibold text-slate-900 dark:text-slate-50">
                {item.value}
              </span>
            )}
            {item.note}
          </button>
        );
      })}
    </div>
  );
}

// Hides a series unless it's the last one showing.
function toggleHidden<K>(current: K[], key: K, total: number): K[] {
  if (current.includes(key)) return current.filter((item) => item !== key);
  return current.length < total - 1 ? [...current, key] : current;
}

export function StatusHistoryCard({
  rows,
  granularity,
  period,
  isDark,
}: {
  rows: StatusHistoryRow[];
  granularity: DashboardTrend["granularity"];
  // The date range picked, e.g. "Last 14 days".
  period: string;
  isDark: boolean;
}) {
  const [hidden, setHidden] = useState<OpenKey[]>([]);
  const colors = statusColors(isDark);
  const latest = rows.at(-1);
  const isEmpty = rows.every((row) => row.todo + row.in_progress === 0);

  return (
    <ChartCard
      title="Open work"
      scope={{ period }}
      subtitle={`Tasks waiting in To do and In progress at the end of each ${granularity}`}
      chartClassName="h-64"
      emptyMessage={isEmpty ? "No open tasks in this period" : undefined}
      description={
        latest
          ? `Now ${latest.todo} to do and ${latest.in_progress} in progress.`
          : undefined
      }
      summary={
        <SeriesToggle
          label="Show or hide a status"
          hidden={hidden}
          onToggle={(key) =>
            setHidden((current) => toggleHidden(current, key, OPEN_KEYS.length))
          }
          series={OPEN_KEYS.map((key) => ({
            key,
            name: STATUS_LABELS[key],
            color: colors[key],
            shape: "line" as const,
            value: latest?.[key],
            note: (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                now
              </span>
            ),
          }))}
        />
      }
    >
      {({ gridColor, tickColor, tooltipProps, surfaceColor }) => (
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -8 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
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
            // Same order as the legend, not alphabetical.
            itemSorter={(item) => OPEN_KEYS.indexOf(item.dataKey as OpenKey)}
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as StatusHistoryRow | undefined)
                ?.fullLabel ?? label
            }
          />
          {OPEN_KEYS.filter((key) => !hidden.includes(key)).map((key) => (
            <Line
              key={key}
              dataKey={key}
              name={STATUS_LABELS[key]}
              type="monotone"
              stroke={colors[key]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={
                rows.length <= 14
                  ? {
                      r: 4,
                      fill: colors[key],
                      stroke: surfaceColor,
                      strokeWidth: 2,
                    }
                  : false
              }
              activeDot={{ r: 5, stroke: surfaceColor, strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      )}
    </ChartCard>
  );
}

export interface FlowRow {
  date: string;
  fullLabel: string;
  created: number;
  completed: number;
}

export interface PeriodChange {
  text: string;
  direction: "up" | "down" | "flat";
}

function ChangePill({ change }: { change: PeriodChange }) {
  return (
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
  );
}

type FlowKey = "created" | "completed";

// Tasks added vs tasks marked done per day, week or month: when the created
// line runs above the completed one, work is piling up.
export function CreatedVsCompletedCard({
  title,
  period,
  rows,
  created,
  completed,
  averageText,
  isDark,
}: {
  title: string;
  period: string;
  rows: FlowRow[];
  created: { total: number; change: PeriodChange | null };
  completed: { total: number; change: PeriodChange | null };
  // e.g. "Avg 3 created and 1.3 completed per day".
  averageText: string | null;
  isDark: boolean;
}) {
  const [hidden, setHidden] = useState<FlowKey[]>([]);
  const mode = isDark ? "dark" : "light";
  const colors: Record<FlowKey, string> = {
    created: CREATED_COLOR[mode],
    completed: statusColors(isDark).done,
  };
  const names: Record<FlowKey, string> = {
    created: "Created",
    completed: "Completed",
  };
  const totals = { created, completed };
  const keys: FlowKey[] = ["created", "completed"];
  const show = (key: FlowKey) => !hidden.includes(key);

  return (
    <ChartCard
      title={title}
      scope={{ period }}
      summary={
        <div className="space-y-2">
          <SeriesToggle
            label="Show or hide a series"
            hidden={hidden}
            onToggle={(key) =>
              setHidden((current) => toggleHidden(current, key, keys.length))
            }
            series={keys.map((key) => ({
              key,
              name: names[key],
              color: colors[key],
              shape: "line" as const,
              value: totals[key].total,
              note: totals[key].change ? (
                <ChangePill change={totals[key].change} />
              ) : undefined,
            }))}
          />
          {averageText && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {averageText}
            </p>
          )}
        </div>
      }
      emptyMessage={
        created.total + completed.total === 0
          ? "No tasks were created or completed in this period"
          : undefined
      }
      description={`${created.total} tasks created${created.change ? `, ${created.change.text}` : ""}. ${completed.total} marked done${completed.change ? `, ${completed.change.text}` : ""}.`}
    >
      {({ gridColor, tickColor, tooltipProps, surfaceColor }) => (
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -8 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
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
            itemSorter={(item) => keys.indexOf(item.dataKey as FlowKey)}
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as FlowRow | undefined)?.fullLabel ?? label
            }
          />
          {keys.filter(show).map((key) => (
            <Area
              key={key}
              // Monotone keeps the curve from dipping below zero or
              // overshooting between points.
              type="monotone"
              dataKey={key}
              name={names[key]}
              stroke={colors[key]}
              strokeWidth={2}
              // A light wash under created only, so the two stay apart.
              fill={colors[key]}
              fillOpacity={key === "created" ? 0.1 : 0}
              dot={
                rows.length <= 14
                  ? {
                      r: 4,
                      fill: colors[key],
                      stroke: surfaceColor,
                      strokeWidth: 2,
                    }
                  : false
              }
              activeDot={{ r: 5, stroke: surfaceColor, strokeWidth: 2 }}
            />
          ))}
        </ComposedChart>
      )}
    </ChartCard>
  );
}

export function StatusDonutCard({
  counts,
  period,
  isDark,
}: {
  // To do and In progress right now; Done in the chosen period.
  counts: Record<StatusKey, number>;
  period: string;
  isDark: boolean;
}) {
  const colors = statusColors(isDark);
  const total = STATUS_KEYS.reduce((sum, key) => sum + counts[key], 0);
  const slices = STATUS_KEYS.map((key) => ({
    key,
    name: STATUS_LABELS[key],
    count: counts[key],
    when: key === "done" ? period : "Now",
  }));
  const mode = isDark ? "dark" : "light";

  return (
    <ChartCard
      title="Where tasks stand"
      scope={{ now: true, period }}
      subtitle="Open now, and done in the chosen period"
      chartClassName="h-44"
      emptyMessage={total === 0 ? "No tasks yet" : undefined}
      description={slices
        .map((slice) => `${slice.name} (${slice.when}): ${slice.count}`)
        .join(", ")}
      footer={
        <ul className="mt-4 space-y-2 text-sm">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-2">
              <SeriesKey color={colors[slice.key]} shape="dot" />
              <span className="text-slate-600 dark:text-slate-300">
                {slice.name}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {slice.when.toLowerCase()}
              </span>
              <span className="ml-auto font-semibold text-slate-900 tabular-nums dark:text-slate-50">
                {slice.count}
              </span>
              <span className="w-10 text-right text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {percent(slice.count, total)}%
              </span>
            </li>
          ))}
        </ul>
      }
    >
      {({ tooltipProps, surfaceColor }) => (
        <PieChart>
          <Tooltip {...tooltipProps} formatter={taskCountFormatter} />
          <Pie
            data={total > 0 ? slices : []}
            dataKey="count"
            nameKey="name"
            innerRadius="68%"
            outerRadius="96%"
            startAngle={90}
            endAngle={-270}
            stroke={surfaceColor}
            strokeWidth={2}
          >
            {slices.map((slice) => (
              <Cell key={slice.key} fill={colors[slice.key]} />
            ))}
            <Label
              position="center"
              value={total}
              dy={-8}
              fontSize={24}
              fontWeight={700}
              fill={TEXT_INK[mode]}
            />
            <Label
              position="center"
              value={total === 1 ? "task" : "tasks"}
              dy={16}
              fontSize={12}
              fill={TEXT_MUTED[mode]}
            />
          </Pie>
        </PieChart>
      )}
    </ChartCard>
  );
}

export function OpenByPriorityCard({
  counts,
  dueSoon,
  isDark,
}: {
  counts: StatusCount[];
  dueSoon: number;
  isDark: boolean;
}) {
  const byKey = new Map(counts.map((entry) => [entry._id, entry.count]));
  const rows = PRIORITY_ROWS.map((row) => ({
    ...row,
    count: byKey.get(row.key) ?? 0,
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const mode = isDark ? "dark" : "light";

  return (
    <ChartCard
      title="Open tasks by priority"
      scope={{ now: true }}
      subtitle="To do and in progress, most urgent first"
      chartClassName="h-44"
      emptyMessage={total === 0 ? "Nothing open right now" : undefined}
      description={rows.map((row) => `${row.label}: ${row.count}`).join(", ")}
      footer={
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            {total}
          </span>{" "}
          open ·{" "}
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            {dueSoon}
          </span>{" "}
          due in the next 7 days
        </p>
      }
    >
      {({ gridColor, tickColor, tooltipProps }) => (
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 36, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke={gridColor} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: tickColor }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={64}
            tick={{ fontSize: 12, fill: tickColor }}
            tickLine={false}
          />
          <Tooltip
            {...tooltipProps}
            cursor={{ fill: gridColor, opacity: 0.4 }}
            formatter={taskCountFormatter}
          />
          <Bar dataKey="count" barSize={22} radius={[0, 4, 4, 0]}>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              fontSize={12}
              fontWeight={600}
              fill={TEXT_INK[mode]}
            />
          </Bar>
        </BarChart>
      )}
    </ChartCard>
  );
}

// Tailwind needs whole class names, so heights are picked from a list.
const WORKLOAD_HEIGHTS = ["h-24", "h-28", "h-36", "h-44", "h-52", "h-60"];

// Fits a name on one axis line: "Priyanka Venkataraman" -> "Priyanka V.".
function shortName(name: string): string {
  if (name.length <= 13) return name;
  const [first, ...rest] = name.trim().split(/\s+/);
  const short = rest.length > 0 ? `${first} ${rest.at(-1)![0]}.` : first;
  return short.length <= 13 ? short : `${short.slice(0, 12)}…`;
}

export function WorkloadCard({
  workload,
  unassigned,
  isDark,
}: {
  workload: WorkloadEntry[];
  unassigned: number;
  isDark: boolean;
}) {
  const colors = statusColors(isDark);
  const rows = workload.slice(0, 6).map((entry) => ({
    ...entry,
    total: entry.todo + entry.inProgress,
  }));
  const mode = isDark ? "dark" : "light";
  const unassignedNote = (
    <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
      {unassigned === 0 ? (
        "Every open task has someone on it."
      ) : (
        <>
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            {unassigned}
          </span>{" "}
          open {unassigned === 1 ? "task has" : "tasks have"} no one assigned
        </>
      )}
    </p>
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardTitle title="Workload" scope={{ now: true }} />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Open tasks per person
        </p>
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          No open tasks are assigned yet.
        </p>
        {unassignedNote}
      </Card>
    );
  }

  return (
    <ChartCard
      title="Workload"
      scope={{ now: true }}
      subtitle="Open tasks per person, busiest first"
      chartClassName={WORKLOAD_HEIGHTS[rows.length - 1]}
      description={rows
        .map(
          (row) =>
            `${row.name}: ${row.inProgress} in progress, ${row.todo} to do`,
        )
        .join("; ")}
      summary={
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5">
            <SeriesKey color={colors.in_progress} shape="dot" />
            In progress
          </span>
          <span className="flex items-center gap-1.5">
            <SeriesKey color={colors.todo} shape="dot" />
            To do
          </span>
        </div>
      }
      footer={unassignedNote}
    >
      {({ gridColor, tickColor, tooltipProps, surfaceColor }) => (
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 36, left: 0, bottom: 0 }}
        >
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tick={{ fontSize: 12, fill: tickColor }}
            tickFormatter={shortName}
            tickLine={false}
          />
          <Tooltip
            {...tooltipProps}
            cursor={{ fill: gridColor, opacity: 0.4 }}
            itemSorter={(item) => (item.dataKey === "inProgress" ? 0 : 1)}
          />
          <Bar
            dataKey="inProgress"
            name="In progress"
            stackId="open"
            barSize={20}
            fill={colors.in_progress}
            stroke={surfaceColor}
            strokeWidth={2}
          />
          <Bar
            dataKey="todo"
            name="To do"
            stackId="open"
            barSize={20}
            fill={colors.todo}
            stroke={surfaceColor}
            strokeWidth={2}
            radius={[0, 4, 4, 0]}
          >
            <LabelList
              dataKey="total"
              position="right"
              fontSize={12}
              fontWeight={600}
              fill={TEXT_INK[mode]}
            />
          </Bar>
        </BarChart>
      )}
    </ChartCard>
  );
}

export function ProjectProgressCard({
  orgId,
  projects,
  limit = 5,
  wide = false,
}: {
  orgId: string;
  projects: ProjectProgress[];
  // How many projects to list; the rest are on the projects page.
  limit?: number;
  // Two columns on wider cards.
  wide?: boolean;
}) {
  const shown = projects.slice(0, limit);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <CardTitle title="Project progress" scope={{ now: true }} />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Share of each project&apos;s tasks that are done
          </p>
        </div>
        <Link
          to={`/orgs/${orgId}/projects`}
          className="shrink-0 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          All projects
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          No active projects yet.
        </p>
      ) : (
        <ul
          className={cn(
            "mt-4 grid gap-4",
            wide && "@2xl:grid-cols-2 @2xl:gap-x-8",
          )}
        >
          {shown.map((project) => {
            const done = percent(project.done, project.total);
            return (
              <li key={project.projectId}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <Link
                    to={`/orgs/${orgId}/projects/${project.projectId}`}
                    className="min-w-0 truncate font-medium text-slate-800 hover:underline dark:text-slate-100"
                  >
                    {project.name}
                  </Link>
                  <span className="shrink-0 text-slate-600 tabular-nums dark:text-slate-300">
                    {project.total === 0
                      ? "No tasks yet"
                      : `${project.done} of ${project.total} done`}
                  </span>
                </div>
                <div
                  role="meter"
                  aria-label={`${project.name} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={done}
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-950"
                >
                  <div
                    className="h-full rounded-full bg-teal-600 dark:bg-teal-400"
                    style={{ width: `${done}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {project.open} open
                  {project.overdue > 0 && (
                    <span className="text-amber-700 dark:text-amber-300">
                      {" "}
                      · ⚠ {project.overdue} overdue
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {projects.length > shown.length && (
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Showing the {limit} with the most open work, of {projects.length}{" "}
          active projects.
        </p>
      )}
    </Card>
  );
}

function UsageMeter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  unit: string;
}) {
  const share = limit > 0 ? Math.min(100, percent(used, limit)) : 0;
  const full = limit > 0 && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="text-slate-900 tabular-nums dark:text-slate-50">
          <span className="font-semibold">{used}</span> of {limit} {unit}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-950"
      >
        <div
          className={cn(
            "h-full rounded-full",
            full ? "bg-amber-500" : "bg-teal-600 dark:bg-teal-400",
          )}
          style={{ width: `${share}%` }}
        />
      </div>
      {full && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          ⚠ Limit reached
        </p>
      )}
    </div>
  );
}

export function WorkspaceCard({ usage }: { usage: DashboardUsage }) {
  return (
    <Card>
      <CardTitle title="Workspace" scope={{ now: true }} />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {usage.memberCount} {usage.memberCount === 1 ? "member" : "members"} on
        your plan
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <UsageMeter
          label="Seats"
          used={usage.seatsUsed}
          limit={usage.seatLimit}
          unit="used"
        />
        <UsageMeter
          label="Projects"
          used={usage.projectCount}
          limit={usage.projectLimit}
          unit="active"
        />
      </div>
    </Card>
  );
}

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
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
  STAGES,
  projectStage,
  statusColors,
  type Stage,
} from "./chartStyles";
import type { ProjectProgress } from "./api";

// Stages borrow the task status colors: waiting, moving, finished.
function stageColors(isDark: boolean): Record<Stage, string> {
  const status = statusColors(isDark);
  return {
    notStarted: status.todo,
    inProgress: status.in_progress,
    completed: status.done,
  };
}

const TEXT_INK = { light: "#0f172a", dark: "#f1f5f9" };
const TEXT_MUTED = { light: "#64748b", dark: "#94a3b8" };

function SwatchKey({ color, shape }: { color: string; shape: "dot" | "bar" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0",
        shape === "dot" ? "size-2.5 rounded-full" : "h-2 w-3 rounded-sm",
      )}
      style={{ backgroundColor: color }}
    />
  );
}

// Axis labels stay on one line; Recharts would otherwise wrap them.
function OneLineTick({
  y,
  payload,
  fill,
}: {
  y?: number | string;
  payload?: { value?: unknown };
  fill: string;
}) {
  return (
    // Left-aligned from the chart's edge, so a long name can't be clipped.
    <text x={0} y={y} dy={4} textAnchor="start" fontSize={12} fill={fill}>
      {String(payload?.value ?? "")}
    </text>
  );
}

// "Mobile app" fits; longer names are cut to fit one axis line, even on
// phones. The tooltip shows the full name.
function shortProjectName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13).trimEnd()}…` : name;
}

// Tailwind needs whole class names, so heights are picked from a list.
const ROW_HEIGHTS = [
  "h-20",
  "h-28",
  "h-36",
  "h-44",
  "h-52",
  "h-60",
  "h-68",
  "h-76",
];

export function ProjectStageCard({
  projects,
  archivedCount,
  period,
  isDark,
}: {
  projects: ProjectProgress[];
  archivedCount: number;
  // The date range picked, e.g. "Last 14 days".
  period: string;
  isDark: boolean;
}) {
  const colors = stageColors(isDark);
  const counts: Record<Stage, number> = {
    notStarted: 0,
    inProgress: 0,
    completed: 0,
  };
  // Finished projects count only if they were finished in the period, so
  // the slice doesn't grow forever.
  let finishedEarlier = 0;
  for (const project of projects) {
    const stage = projectStage(project);
    if (stage === "completed" && !project.finishedInRange) {
      finishedEarlier += 1;
    } else {
      counts[stage] += 1;
    }
  }
  const slices = STAGES.map((stage) => ({
    ...stage,
    name: stage.label,
    count: counts[stage.key],
    when: stage.key === "completed" ? period : "Now",
  }));
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const notCounted = [
    finishedEarlier > 0 && `${finishedEarlier} finished before this period`,
    archivedCount > 0 && `${archivedCount} archived`,
  ].filter(Boolean);
  const mode = isDark ? "dark" : "light";

  return (
    <ChartCard
      title="Project stages"
      scope={{ now: true, period }}
      subtitle="Open now, and finished in the chosen period"
      chartClassName="h-44"
      emptyMessage={total === 0 ? "No active projects yet" : undefined}
      description={slices
        .map((slice) => `${slice.label} (${slice.when}): ${slice.count}`)
        .join(", ")}
      footer={
        <>
          <ul className="mt-4 space-y-2 text-sm">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2">
                <SwatchKey color={colors[slice.key]} shape="dot" />
                <span className="text-slate-600 dark:text-slate-300">
                  {slice.label}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {slice.when.toLowerCase()}
                </span>
                <span className="ml-auto font-semibold text-slate-900 tabular-nums dark:text-slate-50">
                  {slice.count}
                </span>
              </li>
            ))}
          </ul>
          {notCounted.length > 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Not counted: {notCounted.join(" and ")}.
            </p>
          )}
        </>
      }
    >
      {({ tooltipProps, surfaceColor }) => (
        <PieChart>
          <Tooltip
            {...tooltipProps}
            formatter={(value) => [String(value), "Projects"]}
          />
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
              value={total === 1 ? "project" : "projects"}
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

export function OpenWorkByProjectCard({
  projects,
  isDark,
}: {
  projects: ProjectProgress[];
  isDark: boolean;
}) {
  const colors = statusColors(isDark);
  const rows = projects
    .filter((project) => project.open > 0)
    .slice(0, 6)
    .map((project) => ({
      ...project,
      label: shortProjectName(project.name),
    }));
  const mode = isDark ? "dark" : "light";
  const overdueTotal = projects.reduce(
    (sum, project) => sum + project.overdue,
    0,
  );
  const note = (
    <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
      {overdueTotal === 0 ? (
        "No overdue tasks in any project."
      ) : (
        <span className="text-amber-700 dark:text-amber-300">
          <span aria-hidden="true">⚠ </span>
          <span className="font-semibold">{overdueTotal}</span> overdue{" "}
          {overdueTotal === 1 ? "task" : "tasks"} across{" "}
          {projects.filter((project) => project.overdue > 0).length}{" "}
          {projects.filter((project) => project.overdue > 0).length === 1
            ? "project"
            : "projects"}
        </span>
      )}
    </p>
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardTitle title="Open work by project" scope={{ now: true }} />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          To do and in progress tasks in each project
        </p>
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          No open tasks in any project.
        </p>
      </Card>
    );
  }

  return (
    <ChartCard
      title="Open work by project"
      scope={{ now: true }}
      subtitle="To do and in progress, most open first"
      chartClassName={ROW_HEIGHTS[rows.length - 1]}
      description={rows
        .map(
          (row) =>
            `${row.name}: ${row.inProgress} in progress, ${row.todo} to do`,
        )
        .join("; ")}
      // The key sits under the chart, as on the stages card beside it, so
      // the two charts start at the same height.
      footer={
        <>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <SwatchKey color={colors.in_progress} shape="dot" />
              In progress
            </span>
            <span className="flex items-center gap-1.5">
              <SwatchKey color={colors.todo} shape="dot" />
              To do
            </span>
          </div>
          {note}
        </>
      }
    >
      {({ tickColor, tooltipProps, surfaceColor, gridColor }) => (
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 36, left: 0, bottom: 0 }}
        >
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis
            type="category"
            dataKey="label"
            width={112}
            tick={(props) => <OneLineTick {...props} fill={tickColor} />}
            tickLine={false}
          />
          <Tooltip
            {...tooltipProps}
            cursor={{ fill: gridColor, opacity: 0.4 }}
            itemSorter={(item) => (item.dataKey === "inProgress" ? 0 : 1)}
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as { name?: string } | undefined)?.name ??
              label
            }
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
              dataKey="open"
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

export function ProjectActivityCard({
  projects,
  period,
  isDark,
}: {
  projects: ProjectProgress[];
  // The date range picked, e.g. "Last 14 days".
  period: string;
  isDark: boolean;
}) {
  const mode = isDark ? "dark" : "light";
  const doneColor = statusColors(isDark).done;
  const createdColor = CREATED_COLOR[mode];
  const rows = projects
    .filter((project) => project.createdInRange + project.completedInRange > 0)
    .sort(
      (left, right) =>
        right.createdInRange +
        right.completedInRange -
        (left.createdInRange + left.completedInRange),
    )
    .slice(0, 8)
    .map((project) => ({
      ...project,
      label: shortProjectName(project.name),
    }));
  const created = rows.reduce((sum, row) => sum + row.createdInRange, 0);
  const completed = rows.reduce((sum, row) => sum + row.completedInRange, 0);

  return (
    <ChartCard
      title="Created and marked done by project"
      scope={{ period }}
      subtitle="Tasks added and tasks marked done in each project"
      // Two bars per project.
      chartClassName={
        rows.length === 0
          ? "h-32"
          : ROW_HEIGHTS[Math.min(ROW_HEIGHTS.length - 1, rows.length * 2 - 1)]
      }
      emptyMessage={
        rows.length === 0 ? "No tasks were added or finished" : undefined
      }
      description={rows
        .map(
          (row) =>
            `${row.name}: ${row.createdInRange} created, ${row.completedInRange} marked done`,
        )
        .join("; ")}
      summary={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5">
            <SwatchKey color={createdColor} shape="bar" />
            Created
            <span className="font-semibold text-slate-900 dark:text-slate-50">
              {created}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <SwatchKey color={doneColor} shape="bar" />
            Marked done
            <span className="font-semibold text-slate-900 dark:text-slate-50">
              {completed}
            </span>
          </span>
        </div>
      }
    >
      {({ gridColor, tickColor, tooltipProps }) => (
        <BarChart
          data={rows}
          layout="vertical"
          barGap={2}
          barCategoryGap="22%"
          margin={{ top: 0, right: 36, left: 0, bottom: 0 }}
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
            width={112}
            tick={(props) => <OneLineTick {...props} fill={tickColor} />}
            tickLine={false}
          />
          <Tooltip
            {...tooltipProps}
            cursor={{ fill: gridColor, opacity: 0.4 }}
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as { name?: string } | undefined)?.name ??
              label
            }
          />
          <Bar
            dataKey="createdInRange"
            name="Created"
            fill={createdColor}
            maxBarSize={14}
            radius={[0, 4, 4, 0]}
          >
            <LabelList
              dataKey="createdInRange"
              position="right"
              fontSize={11}
              fill={TEXT_MUTED[mode]}
            />
          </Bar>
          <Bar
            dataKey="completedInRange"
            name="Marked done"
            fill={doneColor}
            maxBarSize={14}
            radius={[0, 4, 4, 0]}
          >
            <LabelList
              dataKey="completedInRange"
              position="right"
              fontSize={11}
              fill={TEXT_MUTED[mode]}
            />
          </Bar>
        </BarChart>
      )}
    </ChartCard>
  );
}

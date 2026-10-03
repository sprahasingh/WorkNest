import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Organization } from "../../models/Organization.js";
import { Project, binnedProjectIds } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
import { AuditLog } from "../../models/AuditLog.js";
import { User } from "../../models/User.js";
import { requireTenantId } from "../../tenancy/context.js";
import { isValidTimeZone } from "../../lib/timezone.js";

interface StatusCount {
  _id: string;
  count: number;
}

interface DailyCount {
  date: string;
  count: number;
}

// A number of days, or everything since the org started.
// A number of days, everything since the org started, or a custom span of
// calendar days ("YYYY-MM-DD", both ends included).
export type DashboardRange = number | "all" | { from: string; to: string };

export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
export type TrendGranularity = "day" | "week" | "month";

// How many tasks sat in To do and In progress at the end of one day, week
// or month, and how many were marked done during it.
interface StatusPoint {
  date: string;
  todo: number;
  in_progress: number;
  done: number;
}

type TaskStatus = "todo" | "in_progress" | "done";
const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

interface WorkloadEntry {
  userId: string;
  name: string;
  todo: number;
  inProgress: number;
}

interface ProjectProgress {
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
}

interface TopAssignee {
  userId: string;
  name: string;
  email: string;
  openTaskCount: number;
}

// Dates below are calendar days in the viewer's time zone, held as
// "YYYY-MM-DD" keys and handled as UTC-midnight Dates for arithmetic.
const DAY_MS = 86_400_000;

export { isValidTimeZone };

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

// The calendar day an instant falls on in `timeZone`.
function localDayKey(date: Date, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function dateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// The first day of the day, Monday-based week, or month holding `date`.
function bucketStart(date: Date, granularity: TrendGranularity): Date {
  const start = new Date(date);
  if (granularity === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else if (granularity === "month") {
    start.setUTCDate(1);
  }
  return start;
}

function nextBucket(date: Date, granularity: TrendGranularity): Date {
  const next = new Date(date);
  if (granularity === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (granularity === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

// "All time" starts on the day the org was created, or earlier if it holds
// older tasks (e.g. imported or seeded ones).
async function findOrgStart(tenantId: string): Promise<Date> {
  const [org, firstTask] = await Promise.all([
    Organization.findById(tenantId)
      .select("createdAt")
      .setOptions({ skipTenant: true }),
    Task.findOne({ projectId: { $nin: await binnedProjectIds() } })
      .sort({ createdAt: 1 })
      .select("createdAt"),
  ]);
  const candidates = [org?.createdAt, firstTask?.createdAt].filter(
    (date): date is Date => date instanceof Date,
  );
  return candidates.length > 0
    ? new Date(Math.min(...candidates.map((date) => date.getTime())))
    : new Date();
}

interface TaskHistory {
  points: StatusPoint[];
  // Times tasks were marked done in the range, and in the period before.
  doneInRange: number;
  donePrevious: number;
  // Per project: tasks created and marked done in the range.
  byProject: Map<string, { created: number; completed: number }>;
}

// Rebuilds the trend from today's tasks and the status changes the audit
// log recorded. Tasks only store their current status, so for each bucket
// this starts from today and undoes the changes made after it ended. "Done"
// counts the times a task was marked done during the bucket, so a task that
// was reopened and finished again counts twice. Tasks deleted for good are
// gone from history; binned ones count until the day they were binned.
async function buildTaskHistory({
  bucketEnds,
  excludedProjectIds,
  since,
  tz,
  startKey,
  endKey,
  previousKey,
}: {
  bucketEnds: { date: string; endKey: string }[];
  excludedProjectIds: mongoose.Types.ObjectId[];
  since: Date;
  tz: string;
  startKey: string;
  endKey: string;
  previousKey: string | null;
}): Promise<TaskHistory> {
  const [tasks, changes] = await Promise.all([
    Task.find({
      projectId: { $nin: excludedProjectIds },
      $or: [{ deletedAt: null }, { deletedAt: { $gte: since } }],
    })
      .select("projectId status createdAt deletedAt")
      .setOptions({ includeDeleted: true })
      .lean(),
    AuditLog.find({
      action: "task.updated",
      "metadata.status": { $exists: true },
      createdAt: { $gte: since },
    })
      .select("entityId metadata.status createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
  ]);

  const points: StatusPoint[] = bucketEnds.map(({ date }) => ({
    date,
    todo: 0,
    in_progress: 0,
    done: 0,
  }));
  const byProject = new Map<string, { created: number; completed: number }>();
  const projectEntry = (projectId: string) => {
    let entry = byProject.get(projectId);
    if (!entry) {
      entry = { created: 0, completed: 0 };
      byProject.set(projectId, entry);
    }
    return entry;
  };
  const projectByTask = new Map(
    tasks.map((task) => [task._id.toString(), task.projectId.toString()]),
  );

  let doneInRange = 0;
  let donePrevious = 0;
  const changesByTask = new Map<
    string,
    { dayKey: string; from: TaskStatus }[]
  >();
  for (const change of changes) {
    const taskId = change.entityId.toString();
    const projectId = projectByTask.get(taskId);
    if (!projectId) continue;
    const { from, to } =
      (change.metadata as { status?: { from?: unknown; to?: unknown } })
        ?.status ?? {};
    const dayKey = localDayKey(change.createdAt, tz);

    if (to === "done") {
      if (dayKey >= startKey && dayKey <= endKey) {
        doneInRange += 1;
        projectEntry(projectId).completed += 1;
        const bucket = bucketEnds.findIndex((end) => dayKey <= end.endKey);
        if (bucket >= 0) points[bucket].done += 1;
      } else if (previousKey && dayKey >= previousKey && dayKey < startKey) {
        donePrevious += 1;
      }
    }

    if (!TASK_STATUSES.includes(from as TaskStatus)) continue;
    const list = changesByTask.get(taskId) ?? [];
    list.push({ dayKey, from: from as TaskStatus });
    changesByTask.set(taskId, list);
  }

  for (const task of tasks) {
    const createdKey = localDayKey(task.createdAt, tz);
    const deletedKey = task.deletedAt ? localDayKey(task.deletedAt, tz) : null;
    if (!task.deletedAt && createdKey >= startKey && createdKey <= endKey) {
      projectEntry(task.projectId.toString()).created += 1;
    }
    const taskChanges = changesByTask.get(task._id.toString()) ?? [];
    // Changes on or before a bucket's last day are already in effect.
    let next = 0;
    bucketEnds.forEach(({ endKey: bucketEnd }, index) => {
      while (
        next < taskChanges.length &&
        taskChanges[next].dayKey <= bucketEnd
      ) {
        next += 1;
      }
      if (createdKey > bucketEnd) return;
      if (deletedKey !== null && deletedKey <= bucketEnd) return;
      const status =
        next < taskChanges.length
          ? taskChanges[next].from
          : (task.status as TaskStatus);
      if (status === "todo" || status === "in_progress") {
        points[index][status] += 1;
      }
    });
  }
  return { points, doneInRange, donePrevious, byProject };
}

export async function getDashboard(
  range: DashboardRange = 14,
  timeZone = "UTC",
) {
  const tenantId = requireTenantId();
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const today = keyToDate(localDayKey(new Date(), tz));

  let rangeStart: Date;
  let rangeEnd = today;
  // The equally long period just before, to compare against.
  let previousStart: Date | null = null;
  if (typeof range === "object") {
    // Custom dates can't reach into the future.
    rangeEnd = keyToDate(range.to) > today ? today : keyToDate(range.to);
    rangeStart =
      keyToDate(range.from) > rangeEnd ? rangeEnd : keyToDate(range.from);
    const length =
      Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1;
    previousStart = addDays(rangeStart, -length);
  } else if (range === "all") {
    rangeStart = keyToDate(localDayKey(await findOrgStart(tenantId), tz));
  } else {
    const clampedDays = Math.min(Math.max(range, 7), 90);
    rangeStart = addDays(today, -(clampedDays - 1));
    previousStart = addDays(rangeStart, -clampedDays);
  }

  // Long spans are grouped by week or month so the trend stays readable.
  const spanDays =
    Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1;
  const granularity: TrendGranularity =
    spanDays <= 90 ? "day" : spanDays <= 730 ? "week" : "month";

  // Tasks in projects that are in the bin don't count anywhere.
  const excludedProjectIds = await binnedProjectIds();
  const live = {
    projectId: { $nin: excludedProjectIds },
    deletedAt: null,
  };
  const open = { ...live, status: { $ne: "done" as const }, archivedAt: null };
  const now = new Date();

  // Query a day early: local days start up to 14h before UTC midnight.
  const queryFrom = addDays(previousStart ?? rangeStart, -1);

  const [
    byStatus,
    byPriority,
    createdPerDayRaw,
    topAssigneesRaw,
    overdueCount,
    org,
    memberCount,
    openByPriority,
    workloadRaw,
    unassignedOpenCount,
    projectCountsRaw,
    activeProjects,
    dueSoonCount,
    archivedProjectCount,
  ] = await Promise.all([
    Task.aggregate<StatusCount>([
      { $match: live },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Task.aggregate<StatusCount>([
      { $match: live },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    Task.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          ...live,
          // A day either side: local days are offset from UTC.
          createdAt: { $gte: queryFrom, $lt: addDays(rangeEnd, 2) },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: tz,
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    Task.aggregate<{
      _id: mongoose.Types.ObjectId;
      openTaskCount: number;
      name: string;
      email: string;
    }>([
      {
        $match: {
          ...live,
          status: { $ne: "done" },
          archivedAt: null,
          assigneeIds: { $not: { $size: 0 } },
        },
      },
      { $unwind: "$assigneeIds" },
      { $group: { _id: "$assigneeIds", openTaskCount: { $sum: 1 } } },
      { $sort: { openTaskCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          openTaskCount: 1,
          name: "$user.name",
          email: "$user.email",
        },
      },
    ]),
    Task.countDocuments({
      ...live,
      status: { $ne: "done" },
      archivedAt: null,
      dueDate: { $ne: null, $lte: new Date() },
    }),
    Organization.findById(tenantId).setOptions({ skipTenant: true }),
    Membership.countDocuments({ tenantId: tenantObjectId }).setOptions({
      skipTenant: true,
    }),
    Task.aggregate<StatusCount>([
      { $match: open },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    Task.aggregate<{
      _id: mongoose.Types.ObjectId;
      todo: number;
      inProgress: number;
    }>([
      { $match: { ...open, assigneeIds: { $not: { $size: 0 } } } },
      { $unwind: "$assigneeIds" },
      {
        $group: {
          _id: "$assigneeIds",
          todo: { $sum: { $cond: [{ $eq: ["$status", "todo"] }, 1, 0] } },
          inProgress: {
            $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
          },
        },
      },
      { $sort: { inProgress: -1, todo: -1 } },
    ]),
    Task.countDocuments({ ...open, assigneeIds: { $size: 0 } }),
    Task.aggregate<{
      _id: mongoose.Types.ObjectId;
      total: number;
      todo: number;
      inProgress: number;
      done: number;
      overdue: number;
    }>([
      { $match: live },
      {
        $group: {
          _id: "$projectId",
          total: { $sum: 1 },
          todo: { $sum: { $cond: [{ $eq: ["$status", "todo"] }, 1, 0] } },
          inProgress: {
            $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
          },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$status", "done"] },
                    { $eq: ["$archivedAt", null] },
                    { $ne: ["$dueDate", null] },
                    { $lte: ["$dueDate", now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Project.find({ archivedAt: null }).select("name key").lean(),
    Task.countDocuments({
      ...open,
      dueDate: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY_MS) },
    }),
    Project.countDocuments({ archivedAt: { $ne: null } }),
  ]);

  const startKey = dateToKey(rangeStart);
  const previousKey = previousStart ? dateToKey(previousStart) : null;
  const endKey = dateToKey(rangeEnd);
  const inRange = createdPerDayRaw.filter(
    (entry) => entry._id >= startKey && entry._id <= endKey,
  );

  const countsByBucket = new Map<string, number>();
  for (const entry of inRange) {
    const key = dateToKey(bucketStart(keyToDate(entry._id), granularity));
    countsByBucket.set(key, (countsByBucket.get(key) ?? 0) + entry.count);
  }

  // One point per day, week, or month, each dated by its first day.
  const createdPerDay: DailyCount[] = [];
  for (
    let bucket = bucketStart(rangeStart, granularity);
    bucket <= rangeEnd;
    bucket = nextBucket(bucket, granularity)
  ) {
    const dateKey = dateToKey(bucket);
    createdPerDay.push({
      date: dateKey,
      count: countsByBucket.get(dateKey) ?? 0,
    });
  }

  const sum = (entries: { count: number }[]) =>
    entries.reduce((total, entry) => total + entry.count, 0);

  const topAssignees: TopAssignee[] = topAssigneesRaw.map((entry) => ({
    userId: entry._id.toString(),
    name: entry.name,
    email: entry.email,
    openTaskCount: entry.openTaskCount,
  }));

  const history = await buildTaskHistory({
    bucketEnds: createdPerDay.map(({ date }) => {
      const lastDay = addDays(nextBucket(keyToDate(date), granularity), -1);
      return {
        date,
        endKey: dateToKey(lastDay < rangeEnd ? lastDay : rangeEnd),
      };
    }),
    excludedProjectIds,
    since: addDays(previousStart ?? rangeStart, -1),
    tz,
    startKey,
    endKey,
    previousKey,
  });

  // Everyone with open work, busiest first; the page shows the top few.
  const workloadUsers = await User.find({
    _id: { $in: workloadRaw.map((entry) => entry._id) },
  })
    .select("name")
    .lean();
  const namesById = new Map(
    workloadUsers.map((user) => [user._id.toString(), user.name]),
  );
  const workload: WorkloadEntry[] = workloadRaw
    .filter((entry) => namesById.has(entry._id.toString()))
    .map((entry) => ({
      userId: entry._id.toString(),
      name: namesById.get(entry._id.toString())!,
      todo: entry.todo,
      inProgress: entry.inProgress,
    }))
    .sort(
      (left, right) =>
        right.todo + right.inProgress - (left.todo + left.inProgress),
    )
    .slice(0, 8);

  // Active projects with the most open work first.
  const countsByProject = new Map(
    projectCountsRaw.map((entry) => [entry._id.toString(), entry]),
  );
  const projectProgress: ProjectProgress[] = activeProjects
    .map((project) => {
      const counts = countsByProject.get(project._id.toString());
      const activity = history.byProject.get(project._id.toString());
      const total = counts?.total ?? 0;
      const done = counts?.done ?? 0;
      return {
        projectId: project._id.toString(),
        name: project.name,
        key: project.key,
        total,
        todo: counts?.todo ?? 0,
        inProgress: counts?.inProgress ?? 0,
        done,
        open: total - done,
        overdue: counts?.overdue ?? 0,
        createdInRange: activity?.created ?? 0,
        completedInRange: activity?.completed ?? 0,
      };
    })
    .sort(
      (left, right) =>
        right.open - left.open ||
        right.total - left.total ||
        left.name.localeCompare(right.name),
    );

  return {
    tasksByStatus: byStatus,
    tasksByPriority: byPriority,
    tasksCreatedPerDay: createdPerDay,
    trend: {
      granularity,
      since: startKey,
      // Last day covered; today unless a custom range ends earlier.
      until: endKey,
      // The last point is today / this week / this month, still in progress.
      today: dateToKey(today),
      timeZone: tz,
      total: sum(inRange),
      // Tasks created in the equally long period before; null for all time.
      previousTotal: previousKey
        ? sum(
            createdPerDayRaw.filter(
              (entry) => entry._id >= previousKey && entry._id < startKey,
            ),
          )
        : null,
    },
    // Same points as tasksCreatedPerDay: tasks in To do and In progress at
    // the end of each, and how many were marked done during it.
    statusHistory: history.points,
    // Times tasks were marked done in the range and the period before.
    completed: {
      total: history.doneInRange,
      previousTotal: previousKey ? history.donePrevious : null,
    },
    openByPriority,
    workload,
    unassignedOpenCount,
    projectProgress,
    archivedProjectCount,
    dueSoonCount,
    topAssignees,
    overdueCount,
    usage: {
      seatsUsed: org?.seatsUsed ?? 0,
      seatLimit: org?.seatLimit ?? 0,
      memberCount,
      projectCount: org?.projectCount ?? 0,
      projectLimit: org?.projectLimit ?? 0,
    },
  };
}

import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Organization } from "../../models/Organization.js";
import { binnedProjectIds } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
import { requireTenantId } from "../../tenancy/context.js";

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

interface TopAssignee {
  userId: string;
  name: string;
  email: string;
  openTaskCount: number;
}

// Dates below are calendar days in the viewer's time zone, held as
// "YYYY-MM-DD" keys and handled as UTC-midnight Dates for arithmetic.
const DAY_MS = 86_400_000;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The calendar day an instant falls on in `timeZone`.
function localDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
  const live = {
    projectId: { $nin: await binnedProjectIds() },
    deletedAt: null,
  };

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
      dueDate: { $ne: null, $lt: new Date() },
    }),
    Organization.findById(tenantId).setOptions({ skipTenant: true }),
    Membership.countDocuments({ tenantId: tenantObjectId }).setOptions({
      skipTenant: true,
    }),
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

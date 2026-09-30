import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Organization } from "../../models/Organization.js";
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
export type DashboardRange = number | "all";
export type TrendGranularity = "day" | "week" | "month";

interface TopAssignee {
  userId: string;
  name: string;
  email: string;
  openTaskCount: number;
}

function startOfUtcDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

// The first day of the day, Monday-based week, or month holding `date`.
function bucketStart(date: Date, granularity: TrendGranularity): Date {
  const start = startOfUtcDay(date);
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
    Task.findOne().sort({ createdAt: 1 }).select("createdAt"),
  ]);
  const candidates = [org?.createdAt, firstTask?.createdAt].filter(
    (date): date is Date => date instanceof Date,
  );
  return candidates.length > 0
    ? new Date(Math.min(...candidates.map((date) => date.getTime())))
    : new Date();
}

export async function getDashboard(range: DashboardRange = 14) {
  const tenantId = requireTenantId();
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const today = startOfUtcDay(new Date());

  let rangeStart: Date;
  if (range === "all") {
    rangeStart = startOfUtcDay(await findOrgStart(tenantId));
  } else {
    const clampedDays = Math.min(Math.max(range, 7), 90);
    rangeStart = new Date(today);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - (clampedDays - 1));
  }

  // Long spans are grouped by week or month so the trend stays readable.
  const spanDays =
    Math.round((today.getTime() - rangeStart.getTime()) / 86_400_000) + 1;
  const granularity: TrendGranularity =
    spanDays <= 90 ? "day" : spanDays <= 730 ? "week" : "month";

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
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Task.aggregate<StatusCount>([
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    Task.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: rangeStart } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
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
          status: { $ne: "done" },
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
      status: { $ne: "done" },
      dueDate: { $ne: null, $lt: new Date() },
    }),
    Organization.findById(tenantId).setOptions({ skipTenant: true }),
    Membership.countDocuments({ tenantId: tenantObjectId }).setOptions({
      skipTenant: true,
    }),
  ]);

  const countsByBucket = new Map<string, number>();
  for (const entry of createdPerDayRaw) {
    const key = bucketStart(new Date(entry._id), granularity)
      .toISOString()
      .slice(0, 10);
    countsByBucket.set(key, (countsByBucket.get(key) ?? 0) + entry.count);
  }

  // One point per day, week, or month, each dated by its first day.
  const createdPerDay: DailyCount[] = [];
  for (
    let bucket = bucketStart(rangeStart, granularity);
    bucket <= today;
    bucket = nextBucket(bucket, granularity)
  ) {
    const dateKey = bucket.toISOString().slice(0, 10);
    createdPerDay.push({
      date: dateKey,
      count: countsByBucket.get(dateKey) ?? 0,
    });
  }

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
      since: rangeStart.toISOString().slice(0, 10),
      total: createdPerDayRaw.reduce((sum, entry) => sum + entry.count, 0),
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

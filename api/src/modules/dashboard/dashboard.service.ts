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

interface TopAssignee {
  userId: string;
  name: string;
  email: string;
  openTaskCount: number;
}

export async function getDashboard() {
  const tenantId = requireTenantId();
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  fourteenDaysAgo.setHours(0, 0, 0, 0);

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
      { $match: { createdAt: { $gte: fourteenDaysAgo } } },
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
      { $match: { status: { $ne: "done" }, assigneeId: { $ne: null } } },
      { $group: { _id: "$assigneeId", openTaskCount: { $sum: 1 } } },
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

  const createdPerDay: DailyCount[] = [];
  const countsByDate = new Map(
    createdPerDayRaw.map((entry) => [entry._id, entry.count]),
  );

  for (let i = 0; i < 14; i++) {
    const date = new Date(fourteenDaysAgo);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().slice(0, 10);
    createdPerDay.push({
      date: dateKey,
      count: countsByDate.get(dateKey) ?? 0,
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

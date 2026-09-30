import { Task } from "../models/Task.js";
import { Organization } from "../models/Organization.js";
import { Notification } from "../models/Notification.js";
import { PLAN_LIMITS, PLANS } from "../constants/plans.js";
import { logger } from "../lib/logger.js";

export async function ensureNotificationEventIndex(): Promise<void> {
  await Notification.collection.createIndex(
    { userId: 1, eventKey: 1 },
    {
      unique: true,
      partialFilterExpression: { eventKey: { $type: "string" } },
    },
  );
}

export async function migrateCompletedTaskTimestamps(): Promise<void> {
  await Task.collection.updateMany(
    {
      status: "done",
      $or: [{ completedAt: { $exists: false } }, { completedAt: null }],
    },
    [
      {
        $set: {
          completedAt: { $ifNull: ["$updatedAt", "$createdAt"] },
        },
      },
    ],
  );
}

export async function ensureCompletedTaskIndex(): Promise<void> {
  await Promise.all([
    Task.collection.createIndex({
      tenantId: 1,
      projectId: 1,
      completedAt: -1,
      _id: -1,
    }),
    Task.collection.createIndex({
      tenantId: 1,
      projectId: 1,
      archivedAt: -1,
      _id: -1,
    }),
    Task.collection.createIndex({
      tenantId: 1,
      projectId: 1,
      deletedAt: -1,
      _id: -1,
    }),
  ]);
}

// Each organization stores its seat and project limits. When a plan's limits
// change, bring existing organizations on that plan up to date. Anyone
// already above a lowered limit keeps everything they have; they just can't
// add more until they're back under it.
export async function syncPlanLimits(): Promise<void> {
  for (const plan of PLANS) {
    const { seatLimit, projectLimit } = PLAN_LIMITS[plan];
    const result = await Organization.collection.updateMany(
      {
        plan,
        $or: [
          { seatLimit: { $ne: seatLimit } },
          { projectLimit: { $ne: projectLimit } },
        ],
      },
      { $set: { seatLimit, projectLimit } },
    );
    if (result.modifiedCount > 0) {
      logger.info(
        { plan, updated: result.modifiedCount },
        "Synced organization plan limits",
      );
    }
  }
}

// Tasks created before multi-assignee support stored a single `assigneeId`.
// Move it into `assigneeIds` so old tasks keep their assignee, stay editable
// by that person, and are hidden from members when assigned to a lead.
// Uses the raw collection because the schema no longer knows `assigneeId`.
export async function migrateLegacyTaskAssignees(): Promise<void> {
  const converted = await Task.collection.updateMany(
    { assigneeId: { $exists: true } },
    [
      {
        $set: {
          assigneeIds: {
            $cond: [
              { $eq: [{ $ifNull: ["$assigneeId", null] }, null] },
              { $ifNull: ["$assigneeIds", []] },
              ["$assigneeId"],
            ],
          },
        },
      },
      { $unset: "assigneeId" },
    ],
  );

  const backfilled = await Task.collection.updateMany(
    { assigneeIds: { $exists: false } },
    { $set: { assigneeIds: [] } },
  );

  if (converted.modifiedCount > 0 || backfilled.modifiedCount > 0) {
    logger.info(
      {
        converted: converted.modifiedCount,
        backfilled: backfilled.modifiedCount,
      },
      "Migrated legacy task assignees",
    );
  }
}

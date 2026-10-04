import { Payment } from "../models/Payment.js";
import { JobLock } from "../models/JobLock.js";
import { SignupClaim } from "../models/SignupClaim.js";
import mongoose from "mongoose";
import { dateOnlyDueDate, isValidTimeZone } from "../lib/timezone.js";
import { Task } from "../models/Task.js";
import { Project } from "../models/Project.js";
import { Organization } from "../models/Organization.js";
import {
  Notification,
  READ_NOTIFICATION_TTL_SECONDS,
} from "../models/Notification.js";
import { PLAN_LIMITS, PLANS } from "../constants/plans.js";
import { logger } from "../lib/logger.js";

interface LegacyTaskDueDate {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  dueDate: Date;
}

const DATE_ONLY_MIGRATION_ID = "task-date-only-end-of-day-v1";

export async function migrateDateOnlyTaskDueDates(): Promise<void> {
  const migrationCollection = mongoose.connection.collection<{
    _id: string;
    completedAt: Date;
  }>("schema_migrations");
  if (await migrationCollection.findOne({ _id: DATE_ONLY_MIGRATION_ID }))
    return;

  const cursor = Task.collection
    .find<LegacyTaskDueDate>(
      { dueDate: { $type: "date" } },
      { projection: { _id: 1, tenantId: 1, dueDate: 1 } },
    )
    .batchSize(500);
  let batch: LegacyTaskDueDate[] = [];
  let migratedCount = 0;

  const migrateBatch = async () => {
    if (batch.length === 0) return;

    const tenantIds = [
      ...new Set(batch.map((task) => String(task.tenantId))),
    ].map((id) => new mongoose.Types.ObjectId(id));
    const organizations = await Organization.collection
      .find(
        { _id: { $in: tenantIds } },
        { projection: { _id: 1, timeZone: 1 } },
      )
      .toArray();
    const timeZones = new Map(
      organizations.map((organization) => [
        String(organization._id),
        typeof organization.timeZone === "string" &&
        isValidTimeZone(organization.timeZone)
          ? organization.timeZone
          : "UTC",
      ]),
    );

    await Task.collection.bulkWrite(
      batch.map((task) => {
        const timeZone = timeZones.get(String(task.tenantId)) ?? "UTC";
        const dateKey = task.dueDate.toISOString().slice(0, 10);
        return {
          updateOne: {
            filter: { _id: task._id, dueDate: task.dueDate },
            update: {
              $set: {
                dueDate: dateOnlyDueDate(dateKey, timeZone),
                dueDateIsDateOnly: true,
              },
              $inc: { reminderCycle: 1 },
            },
          },
        };
      }),
      { ordered: false },
    );
    await Notification.collection.deleteMany({
      taskId: { $in: batch.map((task) => task._id) },
      type: { $in: ["task_due_soon", "task_overdue"] },
    });
    migratedCount += batch.length;
    batch = [];
  };

  for await (const task of cursor) {
    const dueDate = task.dueDate;
    if (
      dueDate.getUTCHours() !== 0 ||
      dueDate.getUTCMinutes() !== 0 ||
      dueDate.getUTCSeconds() !== 0 ||
      dueDate.getUTCMilliseconds() !== 0
    ) {
      continue;
    }
    batch.push(task);
    if (batch.length === 500) await migrateBatch();
  }
  await migrateBatch();
  try {
    await migrationCollection.insertOne({
      _id: DATE_ONLY_MIGRATION_ID,
      completedAt: new Date(),
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  if (migratedCount > 0) {
    logger.info({ migratedCount }, "Migrated date-only task due dates");
  }
}

// Production doesn't build indexes automatically, so the read-notification
// clean-up index is created here.
export async function ensureNotificationRetentionIndex(): Promise<void> {
  await Notification.collection.createIndex(
    { readAt: 1 },
    { expireAfterSeconds: READ_NOTIFICATION_TTL_SECONDS },
  );
}

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

export async function syncActiveProjectCounts(): Promise<void> {
  const counts = await Project.collection
    .aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { archivedAt: null, deletedAt: null } },
      {
        $lookup: {
          from: Task.collection.name,
          let: { projectId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$projectId", "$$projectId"] },
                    { $eq: [{ $ifNull: ["$deletedAt", null] }, null] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                unfinished: {
                  $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] },
                },
              },
            },
          ],
          as: "taskCounts",
        },
      },
      {
        $match: {
          $or: [
            { "taskCounts.0": { $exists: false } },
            {
              $expr: {
                $gt: [{ $arrayElemAt: ["$taskCounts.unfinished", 0] }, 0],
              },
            },
          ],
        },
      },
      { $group: { _id: "$tenantId", count: { $sum: 1 } } },
    ])
    .toArray();

  // Every organization gets its own number in one pass. Resetting everything
  // to 0 first would leave a gap where limits aren't enforced and a project
  // created in that moment is never counted.
  const orgs = await Organization.collection
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const countByOrg = new Map(
    counts.map(({ _id, count }) => [String(_id), count]),
  );
  if (orgs.length > 0) {
    await Organization.collection.bulkWrite(
      orgs.map(({ _id }) => ({
        updateOne: {
          filter: { _id },
          update: { $set: { projectCount: countByOrg.get(String(_id)) ?? 0 } },
        },
      })),
    );
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

// In production Mongoose does not build indexes by itself, and the sync script
// has to be run by hand. Some indexes protect correctness (a payment order can
// only exist once, a job lock is one row per job, a sign-up claim expires), so
// the ones that were added after launch are created here at startup. This only
// adds missing indexes: it never drops or rebuilds an existing one.
export async function ensureSafetyIndexes(): Promise<void> {
  const models = [Payment, JobLock, SignupClaim, Task, Project];
  for (const model of models) {
    try {
      await model.createIndexes();
    } catch (error) {
      logger.error(
        { err: error, model: model.modelName },
        "Could not create indexes",
      );
    }
  }
}

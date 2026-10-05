import mongoose from "mongoose";
import { GRACE_PERIOD_DAYS, PLAN_LIMITS } from "../../constants/plans.js";
import { logger } from "../../lib/logger.js";
import { Notification } from "../../models/Notification.js";
import { Organization } from "../../models/Organization.js";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { runWithTenant } from "../../tenancy/context.js";
import { recordAudit } from "../audit/audit.service.js";
import { releaseProjectSlot } from "../orgs/orgs.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GraceSummary {
  projects: number;
  tasks: number;
}

const time = (date: Date | null | undefined) => (date ? date.getTime() : 0);

// Newest first; the id breaks ties so the same data always gives the same
// order.
function byRecency<T extends { last: number; id: string }>(a: T, b: T) {
  return b.last - a.last || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

// Brings the current organization (the tenant context) within the Free plan
// by archiving the least recently active extras. Nothing is deleted: archived
// projects and tasks can be restored once there is room again. A project or
// task counts as active when it, or anything done in it (tasks, comments and
// updates), changed most recently.
export async function archiveExcessForFree(): Promise<GraceSummary> {
  const limits = PLAN_LIMITS.free;
  const summary: GraceSummary = { projects: 0, tasks: 0 };

  // 1. Projects. Only those that use a plan slot (not archived, and with open
  // work or no tasks yet) count against the limit.
  const [taskStats, activityByProject] = await Promise.all([
    Task.aggregate<{
      _id: mongoose.Types.ObjectId;
      total: number;
      unfinished: number;
      last: Date | null;
    }>([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: "$projectId",
          total: { $sum: 1 },
          unfinished: { $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] } },
          last: { $max: "$updatedAt" },
        },
      },
    ]),
    TaskActivity.aggregate<{ _id: mongoose.Types.ObjectId; last: Date }>([
      { $group: { _id: "$projectId", last: { $max: "$createdAt" } } },
    ]),
  ]);
  const stats = new Map(taskStats.map((row) => [String(row._id), row]));
  const activity = new Map(
    activityByProject.map((row) => [String(row._id), time(row.last)]),
  );

  const projects = await Project.find({ archivedAt: null })
    .select("updatedAt")
    .lean();
  const usingSlot = projects
    .filter((project) => {
      const row = stats.get(String(project._id));
      return !row || row.total === 0 || row.unfinished > 0;
    })
    .map((project) => {
      const id = String(project._id);
      return {
        id,
        last: Math.max(
          time(project.updatedAt),
          time(stats.get(id)?.last),
          activity.get(id) ?? 0,
        ),
      };
    })
    .sort(byRecency);

  const extras = usingSlot.slice(limits.projectLimit);
  if (extras.length > 0) {
    // archiveProject recalculates slot usage from tasks. Since this operation
    // archives several projects in sequence, its counter can become stale
    // relative to the precomputed selection. Archive the chosen extras as one
    // transaction and release exactly the slots they occupied.
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const tenantId = String(
          await Project.findById(extras[0]!.id)
            .select("tenantId")
            .session(dbSession)
            .then((project) => project?.tenantId),
        );
        for (const extra of extras) {
          const project = await Project.findOneAndUpdate(
            { _id: extra.id, archivedAt: null },
            { archivedAt: new Date(), archivedReason: "plan_limit" },
            { new: true, session: dbSession },
          );
          if (!project) continue;
          await releaseProjectSlot(tenantId, dbSession);
          await recordAudit(
            {
              action: "project.archived",
              entityType: "Project",
              entityId: extra.id,
              metadata: { reason: "plan_limit" },
            },
            dbSession,
          );
          summary.projects += 1;
        }
      });
    } finally {
      await dbSession.endSession();
    }
  }

  // 2. Open tasks, per project. Projects that are archived (by a person, or
  // just now because of the plan) are left alone: they aren't in use, their
  // tasks are still readable, and a project can only be restored if its open
  // tasks fit the plan.
  const taskLimit = limits.activeTaskLimit;
  if (taskLimit !== null) {
    const crowded = await Task.aggregate<{ _id: mongoose.Types.ObjectId }>([
      {
        $match: { status: { $ne: "done" }, archivedAt: null, deletedAt: null },
      },
      { $group: { _id: "$projectId", active: { $sum: 1 } } },
      { $match: { active: { $gt: taskLimit } } },
    ]);
    const liveProjects = new Set(
      (
        await Project.find({
          _id: { $in: crowded.map((row) => row._id) },
          archivedAt: null,
        })
          .select("_id")
          .lean()
      ).map((project) => String(project._id)),
    );

    for (const row of crowded) {
      if (!liveProjects.has(String(row._id))) continue;
      const tasks = await Task.find({
        projectId: row._id,
        status: { $ne: "done" },
        archivedAt: null,
      })
        .select("updatedAt")
        .lean();
      const taskActivity = new Map(
        (
          await TaskActivity.aggregate<{
            _id: mongoose.Types.ObjectId;
            last: Date;
          }>([
            { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
            { $group: { _id: "$taskId", last: { $max: "$createdAt" } } },
          ])
        ).map((entry) => [String(entry._id), time(entry.last)]),
      );
      const extras = tasks
        .map((task) => ({
          id: String(task._id),
          last: Math.max(
            time(task.updatedAt),
            taskActivity.get(String(task._id)) ?? 0,
          ),
        }))
        .sort(byRecency)
        .slice(taskLimit);
      if (extras.length === 0) continue;

      const ids = extras.map((task) => task.id);
      const dbSession = await mongoose.startSession();
      try {
        await dbSession.withTransaction(async () => {
          await Task.updateMany(
            { _id: { $in: ids }, archivedAt: null },
            { archivedAt: new Date(), archivedReason: "plan_limit" },
            // Keep "last changed" as it was, so the order stays meaningful.
            { session: dbSession, timestamps: false },
          );
          await Notification.updateMany(
            {
              tenantId: (await Project.findById(row._id).session(dbSession))!
                .tenantId,
              taskId: { $in: ids },
              type: { $in: ["task_due_soon", "task_overdue"] },
              dismissedAt: null,
            },
            { dismissedAt: new Date() },
            { session: dbSession },
          );
          await recordAudit(
            {
              action: "tasks.auto_archived",
              entityType: "Project",
              entityId: String(row._id),
              metadata: { count: ids.length, reason: "plan_limit" },
            },
            dbSession,
          );
        });
      } finally {
        await dbSession.endSession();
      }
      summary.tasks += ids.length;
    }
  }
  return summary;
}

const CLAIM_STALE_MS = 2 * 60 * 1000;

// Once the grace period after an expired plan is over, archives whatever the
// Free plan doesn't allow. Runs once per expiry: the first caller takes a hold
// and the work is only marked done (graceEnforcedAt) when it has finished, so
// a request that arrives meanwhile still sees the grace rules instead of a
// workspace that looks paused. With `again`, runs on a workspace that was
// already done but is over on projects or tasks. Returns whether it ran.
export async function enforceGraceIfDue(
  tenantId: string,
  options: { again?: boolean; now?: Date } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_MS);
  const claimed = await Organization.findOneAndUpdate(
    {
      _id: tenantId,
      plan: "free",
      planExpiredAt: { $ne: null, $lte: cutoff },
      graceEnforcedAt: options.again ? { $ne: null } : null,
      $or: [
        { graceEnforcingAt: null },
        { graceEnforcingAt: { $lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
      ],
    },
    { graceEnforcingAt: now },
    { returnDocument: "before" },
  )
    .select("createdBy graceArchived")
    .setOptions({ skipTenant: true })
    .lean<{
      createdBy: unknown;
      graceArchived?: { projects?: number; tasks?: number } | null;
    }>();
  if (!claimed) return false;

  try {
    // The audit log needs someone to name; the organization's creator stands in
    // for the system.
    const summary = await runWithTenant(
      { tenantId, userId: String(claimed.createdBy), role: "admin" },
      archiveExcessForFree,
    );
    const total = {
      projects: summary.projects + (claimed.graceArchived?.projects ?? 0),
      tasks: summary.tasks + (claimed.graceArchived?.tasks ?? 0),
    };
    await Organization.updateOne(
      { _id: tenantId },
      options.again
        ? { graceArchived: total, graceEnforcingAt: null }
        : {
            graceArchived: summary,
            graceEnforcedAt: new Date(),
            graceEnforcingAt: null,
          },
    ).setOptions({ skipTenant: true });
    logger.info({ tenantId, ...summary }, "Archived usage over the Free plan");
    return true;
  } catch (error) {
    // Let the next request or sweep try again.
    await Organization.updateOne(
      { _id: tenantId },
      { graceEnforcingAt: null },
    ).setOptions({ skipTenant: true });
    logger.error({ err: error, tenantId }, "Could not archive over-plan usage");
    return false;
  }
}

export async function enforceDueGracePeriods(
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_MS);
  const due = await Organization.find({
    plan: "free",
    planExpiredAt: { $ne: null, $lte: cutoff },
    graceEnforcedAt: null,
  })
    .select("_id")
    .setOptions({ skipTenant: true })
    .lean();
  let done = 0;
  for (const org of due) {
    if (await enforceGraceIfDue(String(org._id), { now })) done += 1;
  }
  return done;
}

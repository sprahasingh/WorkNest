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
import { archiveProject } from "../projects/projects.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GraceSummary {
  projects: number;
  tasks: number;
}

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
      last: Date;
    }>([
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
    activityByProject.map((row) => [String(row._id), row.last.getTime()]),
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
          project.updatedAt.getTime(),
          stats.get(id)?.last.getTime() ?? 0,
          activity.get(id) ?? 0,
        ),
      };
    })
    .sort(byRecency);

  for (const extra of usingSlot.slice(limits.projectLimit)) {
    await archiveProject(extra.id, { reason: "plan_limit" });
    summary.projects += 1;
  }

  // 2. Open tasks, per project. Projects that are archived (by a person, or
  // just now because of the plan) are left alone: they aren't in use, their
  // tasks are still readable, and a project can only be restored if its open
  // tasks fit the plan.
  const taskLimit = limits.activeTaskLimit;
  if (taskLimit !== null) {
    const crowded = await Task.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: { status: { $ne: "done" }, archivedAt: null } },
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
        ).map((entry) => [String(entry._id), entry.last.getTime()]),
      );
      const extras = tasks
        .map((task) => ({
          id: String(task._id),
          last: Math.max(
            task.updatedAt.getTime(),
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

// Once the grace period after an expired plan is over, archives whatever the
// Free plan doesn't allow. Runs once per expiry: the first caller claims it, so
// a request and the sweep can't both do it. Returns whether it ran.
export async function enforceGraceIfDue(
  tenantId: string,
  now = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_MS);
  const claimed = await Organization.findOneAndUpdate(
    {
      _id: tenantId,
      plan: "free",
      planExpiredAt: { $ne: null, $lte: cutoff },
      graceEnforcedAt: null,
    },
    { graceEnforcedAt: now },
    { returnDocument: "before" },
  )
    .select("createdBy")
    .setOptions({ skipTenant: true });
  if (!claimed) return false;

  try {
    // The audit log needs someone to name; the organization's creator stands in
    // for the system.
    const summary = await runWithTenant(
      { tenantId, userId: String(claimed.createdBy), role: "admin" },
      archiveExcessForFree,
    );
    await Organization.updateOne(
      { _id: tenantId },
      { graceArchived: summary },
    ).setOptions({ skipTenant: true });
    logger.info({ tenantId, ...summary }, "Archived usage over the Free plan");
  } catch (error) {
    // Let the next request or sweep try again.
    await Organization.updateOne(
      { _id: tenantId },
      { graceEnforcedAt: null },
    ).setOptions({ skipTenant: true });
    logger.error({ err: error, tenantId }, "Could not archive over-plan usage");
    return false;
  }
  return true;
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
    if (await enforceGraceIfDue(String(org._id), now)) done += 1;
  }
  return done;
}

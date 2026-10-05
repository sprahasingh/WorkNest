import mongoose from "mongoose";
import { GRACE_PERIOD_DAYS, PLAN_LIMITS } from "../../constants/plans.js";
import { logger } from "../../lib/logger.js";
import { Notification } from "../../models/Notification.js";
import { Organization } from "../../models/Organization.js";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { requireTenantId, runWithTenant } from "../../tenancy/context.js";
import { recordAudit } from "../audit/audit.service.js";
import { releaseProjectSlot } from "../orgs/orgs.service.js";
import { getPlanUsage } from "./planLifecycle.js";

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
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      summary.projects = 0;
      summary.tasks = 0;

      const organization = await Organization.findOne({
        _id: tenantId,
        plan: "free",
      })
        .select("_id")
        .session(dbSession)
        .setOptions({ skipTenant: true })
        .lean();
      if (!organization) return;

      // 1. Projects. Done-only projects do not use a slot; empty projects and
      // projects with at least one open task do.
      const taskStats = await Task.aggregate<{
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
            unfinished: {
              $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] },
            },
            last: { $max: "$updatedAt" },
          },
        },
      ]).session(dbSession);
      const activityByProject = await TaskActivity.aggregate<{
        _id: mongoose.Types.ObjectId;
        last: Date;
      }>([
        { $group: { _id: "$projectId", last: { $max: "$createdAt" } } },
      ]).session(dbSession);
      const stats = new Map(taskStats.map((row) => [String(row._id), row]));
      const activity = new Map(
        activityByProject.map((row) => [String(row._id), time(row.last)]),
      );
      const projects = await Project.find({ archivedAt: null })
        .select("updatedAt")
        .session(dbSession)
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
      for (const extra of usingSlot.slice(limits.projectLimit)) {
        const project = await Project.findOneAndUpdate(
          { _id: extra.id, archivedAt: null },
          { archivedAt: new Date(), archivedReason: "plan_limit" },
          { returnDocument: "after", session: dbSession },
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

      // 2. Trim open tasks only in projects that remain active. Explicitly
      // exclude completed, archived and binned tasks from both counting and
      // selection.
      const taskLimit = limits.activeTaskLimit;
      if (taskLimit !== null) {
        const crowded = await Task.aggregate<{
          _id: mongoose.Types.ObjectId;
        }>([
          {
            $match: {
              status: { $ne: "done" },
              archivedAt: null,
              deletedAt: null,
            },
          },
          { $group: { _id: "$projectId", active: { $sum: 1 } } },
          { $match: { active: { $gt: taskLimit } } },
        ]).session(dbSession);
        const liveProjects = new Set(
          (
            await Project.find({
              _id: { $in: crowded.map((row) => row._id) },
              archivedAt: null,
            })
              .select("_id")
              .session(dbSession)
              .lean()
          ).map((project) => String(project._id)),
        );

        for (const row of crowded) {
          if (!liveProjects.has(String(row._id))) continue;
          const tasks = await Task.find({
            projectId: row._id,
            status: { $ne: "done" },
            archivedAt: null,
            deletedAt: null,
          })
            .select("updatedAt")
            .session(dbSession)
            .lean();
          const taskActivity = new Map(
            (
              await TaskActivity.aggregate<{
                _id: mongoose.Types.ObjectId;
                last: Date;
              }>([
                { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
                { $group: { _id: "$taskId", last: { $max: "$createdAt" } } },
              ]).session(dbSession)
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
          const project = await Project.findById(row._id)
            .select("tenantId")
            .session(dbSession);
          if (!project) continue;
          await Task.updateMany(
            {
              _id: { $in: ids },
              status: { $ne: "done" },
              archivedAt: null,
              deletedAt: null,
            },
            { archivedAt: new Date(), archivedReason: "plan_limit" },
            { session: dbSession, timestamps: false },
          );
          await Notification.updateMany(
            {
              tenantId: project.tenantId,
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
          summary.tasks += ids.length;
        }
      }

      // Refresh the slot counter from the same completed/open task semantics
      // before committing so usage checks see the actual post-archive count.
      const remaining = await Project.find({ archivedAt: null })
        .select("_id")
        .session(dbSession)
        .lean();
      const remainingStats = await Task.aggregate<{
        _id: mongoose.Types.ObjectId;
        total: number;
        unfinished: number;
      }>([
        {
          $match: {
            projectId: { $in: remaining.map((project) => project._id) },
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: "$projectId",
            total: { $sum: 1 },
            unfinished: {
              $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] },
            },
          },
        },
      ]).session(dbSession);
      const remainingById = new Map(
        remainingStats.map((row) => [String(row._id), row]),
      );
      const activeProjects = remaining.filter((project) => {
        const row = remainingById.get(String(project._id));
        return !row || row.total === 0 || row.unfinished > 0;
      }).length;
      await Organization.updateOne(
        { _id: tenantId },
        { projectCount: activeProjects },
        { session: dbSession },
      ).setOptions({ skipTenant: true });
    });
    return summary;
  } finally {
    await dbSession.endSession();
  }
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
    const completed = await Organization.updateOne(
      {
        _id: tenantId,
        plan: "free",
        planExpiredAt: { $ne: null, $lte: cutoff },
        graceEnforcingAt: now,
      },
      options.again
        ? { graceArchived: total, graceEnforcingAt: null }
        : {
            graceArchived: summary,
            graceEnforcedAt: new Date(),
            graceEnforcingAt: null,
          },
    ).setOptions({ skipTenant: true });
    if (completed.matchedCount === 0) return false;
    logger.info({ tenantId, ...summary }, "Archived usage over the Free plan");
    return true;
  } catch (error) {
    // Let the next request or sweep try again.
    await Organization.updateOne(
      { _id: tenantId, graceEnforcingAt: now },
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
  })
    .select("_id")
    .setOptions({ skipTenant: true })
    .lean();
  let done = 0;
  for (const org of due) {
    const tenantId = String(org._id);
    if (await enforceGraceIfDue(tenantId, { now })) {
      done += 1;
      continue;
    }
    const usage = await runWithTenant(
      { tenantId, userId: "system", role: "admin" },
      () => getPlanUsage(tenantId),
    );
    if (usage.graceEnforced && usage.workOverLimit) {
      if (await enforceGraceIfDue(tenantId, { again: true, now })) done += 1;
    }
  }
  return done;
}

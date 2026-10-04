import mongoose from "mongoose";
import { Organization } from "../../models/Organization.js";
import { Membership } from "../../models/Membership.js";
import { Task } from "../../models/Task.js";
import { Notification } from "../../models/Notification.js";
import { requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import { PLAN_LIMITS, type Plan } from "../../constants/plans.js";
import { Project, binnedProjectIds } from "../../models/Project.js";
import { dateKeyInTimeZone, dateOnlyDueDate } from "../../lib/timezone.js";
import type { UpdateOrgInput } from "./orgs.schemas.js";

export function generateSlug(orgName: string): string {
  const base = orgName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function createOrg(userId: string, name: string) {
  const dbSession = await mongoose.startSession();

  try {
    let organizationId: mongoose.Types.ObjectId;

    await dbSession.withTransaction(async () => {
      const [organization] = await Organization.create(
        [
          {
            name,
            slug: generateSlug(name),
            plan: "free",
            seatLimit: PLAN_LIMITS.free.seatLimit,
            seatsUsed: 1,
            projectLimit: PLAN_LIMITS.free.projectLimit,
            projectCount: 0,
            adminCount: 1,
            createdBy: userId,
          },
        ],
        { session: dbSession },
      );

      const membershipDoc = new Membership({
        tenantId: organization._id,
        userId,
        role: "admin",
      });
      membershipDoc.$locals.skipTenant = true;
      await membershipDoc.save({ session: dbSession });

      organizationId = organization._id;
    });

    return await Organization.findById(organizationId!).setOptions({
      skipTenant: true,
    });
  } finally {
    await dbSession.endSession();
  }
}

export async function updateOrg(input: UpdateOrgInput) {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    let org;

    await dbSession.withTransaction(async () => {
      const before = await Organization.findById(tenantId)
        .session(dbSession)
        .setOptions({ skipTenant: true });

      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Organization not found");
      }

      const previousTimeZone =
        typeof before.timeZone === "string" ? before.timeZone : "UTC";
      if (input.timeZone !== undefined && input.timeZone !== previousTimeZone) {
        const tasks = await Task.find({
          dueDate: { $ne: null },
          dueDateIsDateOnly: true,
        })
          .select("_id dueDate")
          .setOptions({ includeDeleted: true })
          .session(dbSession)
          .lean();
        if (tasks.length > 0) {
          await Task.bulkWrite(
            tasks.map((task) => {
              const dueDate = task.dueDate as Date;
              return {
                updateOne: {
                  filter: { _id: task._id },
                  update: {
                    $set: {
                      dueDate: dateOnlyDueDate(
                        dateKeyInTimeZone(dueDate, previousTimeZone),
                        input.timeZone!,
                      ),
                    },
                    $inc: { reminderCycle: 1 },
                  },
                },
              };
            }),
            { session: dbSession, ordered: false },
          );
        }
        // Projects with a date-only due date move the same way, so their
        // calendar day doesn't shift when the organization's time zone does.
        const projects = await Project.find({
          dueDate: { $ne: null },
          dueDateIsDateOnly: true,
        })
          .select("_id dueDate")
          .session(dbSession)
          .lean();
        if (projects.length > 0) {
          await Project.bulkWrite(
            projects.map((project) => ({
              updateOne: {
                filter: { _id: project._id },
                update: {
                  $set: {
                    dueDate: dateOnlyDueDate(
                      dateKeyInTimeZone(
                        project.dueDate as Date,
                        previousTimeZone,
                      ),
                      input.timeZone!,
                    ),
                  },
                  $inc: { reminderCycle: 1 },
                },
              },
            })),
            { session: dbSession, ordered: false },
          );
        }
        await Notification.deleteMany(
          {
            tenantId,
            type: {
              $in: [
                "task_due_soon",
                "task_overdue",
                "project_due_soon",
                "project_overdue",
              ],
            },
          },
          { session: dbSession },
        );
      }

      const changes = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
        ...(input.chatRetentionDays !== undefined
          ? { chatRetentionDays: input.chatRetentionDays }
          : {}),
      };
      const updated = await Organization.findByIdAndUpdate(tenantId, changes, {
        new: true,
        runValidators: true,
        session: dbSession,
      }).setOptions({ skipTenant: true });

      await recordAudit(
        {
          action:
            input.chatRetentionDays !== undefined ||
            (input.name !== undefined && input.timeZone !== undefined)
              ? "org.settings_updated"
              : input.timeZone !== undefined
                ? "org.timezone_changed"
                : "org.renamed",
          entityType: "Organization",
          entityId: tenantId,
          metadata: {
            ...(input.name !== undefined
              ? { name: { from: before.name, to: input.name } }
              : {}),
            ...(input.timeZone !== undefined
              ? {
                  timeZone: {
                    from: before.timeZone ?? "UTC",
                    to: input.timeZone,
                  },
                }
              : {}),
            ...(input.chatRetentionDays !== undefined
              ? {
                  chatRetentionDays: {
                    from: before.chatRetentionDays ?? null,
                    to: input.chatRetentionDays,
                  },
                }
              : {}),
          },
        },
        dbSession,
      );

      org = updated;
    });

    return org!;
  } finally {
    await dbSession.endSession();
  }
}

export async function changePlan(
  newPlan: Plan,
  payment?: { paymentId: string; orderId: string; amount: number },
) {
  const tenantId = requireTenantId();
  const limits = PLAN_LIMITS[newPlan];
  const dbSession = await mongoose.startSession();

  try {
    let org;

    await dbSession.withTransaction(async () => {
      const previous = await Organization.findById(tenantId)
        .session(dbSession)
        .setOptions({ skipTenant: true });

      const binned = await binnedProjectIds();
      // Projects already holding more active tasks than the new plan allows.
      const projectsOverTaskLimit =
        limits.activeTaskLimit === null
          ? 0
          : (
              await Task.aggregate<{ _id: unknown }>([
                {
                  $match: {
                    status: { $ne: "done" },
                    archivedAt: null,
                    deletedAt: null,
                    // Tasks in a binned project can't be seen, so they don't
                    // count against a smaller plan either.
                    projectId: { $nin: binned },
                  },
                },
                { $group: { _id: "$projectId", active: { $sum: 1 } } },
                { $match: { active: { $gt: limits.activeTaskLimit } } },
              ]).session(dbSession)
            ).length;

      const blocked = (): never => {
        throw new AppError(
          409,
          "PLAN_DOWNGRADE_BLOCKED",
          "Current usage exceeds the limits of the target plan",
          [
            {
              seatsUsed: previous?.seatsUsed,
              projectCount: previous?.projectCount,
              projectsOverTaskLimit,
              targetSeatLimit: limits.seatLimit,
              targetProjectLimit: limits.projectLimit,
              targetActiveTaskLimit: limits.activeTaskLimit,
            },
          ],
        );
      };

      if (projectsOverTaskLimit > 0) blocked();

      const updated = await Organization.findOneAndUpdate(
        {
          _id: tenantId,
          $expr: {
            $and: [
              { $lte: ["$seatsUsed", limits.seatLimit] },
              { $lte: ["$projectCount", limits.projectLimit] },
            ],
          },
        },
        {
          plan: newPlan,
          seatLimit: limits.seatLimit,
          projectLimit: limits.projectLimit,
        },
        { returnDocument: "after", session: dbSession },
      ).setOptions({ skipTenant: true });

      if (!updated) blocked();

      await recordAudit(
        {
          action: "plan.changed",
          entityType: "Organization",
          entityId: tenantId,
          metadata: {
            plan: { from: previous?.plan, to: newPlan },
            ...(payment ? { payment } : {}),
          },
        },
        dbSession,
      );

      org = updated;
    });

    return org!;
  } finally {
    await dbSession.endSession();
  }
}

export async function reserveProjectSlot(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const org = await Organization.findOneAndUpdate(
    {
      _id: tenantId,
      $expr: { $lt: ["$projectCount", "$projectLimit"] },
    },
    { $inc: { projectCount: 1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });

  if (!org) {
    throw new AppError(
      409,
      "PROJECT_LIMIT_REACHED",
      "No project slots remaining on the current plan",
    );
  }
}

// Whether a project takes a plan slot: it isn't archived and still has open
// work (or no tasks yet). Called at the start of every transaction that can
// change that, it also bumps the project's revision, so two such changes to
// one project conflict and one is retried instead of both acting on a stale
// count.
export async function projectConsumesSlot(
  projectId: string | mongoose.Types.ObjectId,
  dbSession: mongoose.ClientSession,
): Promise<boolean> {
  await Project.updateOne(
    { _id: projectId },
    { $inc: { revision: 1 } },
    { session: dbSession, timestamps: false },
  );
  const project = await Project.findById(projectId).session(dbSession);
  if (!project || project.archivedAt) return false;

  const [taskCounts] = await Task.aggregate<{
    total: number;
    unfinished: number;
  }>([
    { $match: { projectId: project._id, deletedAt: null } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        unfinished: {
          $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] },
        },
      },
    },
  ]).session(dbSession);

  return !taskCounts || taskCounts.total === 0 || taskCounts.unfinished > 0;
}

export async function syncProjectSlot(
  tenantId: string,
  projectId: string | mongoose.Types.ObjectId,
  wasActive: boolean,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const isActive = await projectConsumesSlot(projectId, dbSession);
  if (wasActive === isActive) return;

  if (!isActive) {
    await releaseProjectSlot(tenantId, dbSession);
    return;
  }
  try {
    await reserveProjectSlot(tenantId, dbSession);
  } catch (error) {
    // Usually a task being added to or reopened in a finished project.
    if (error instanceof AppError && error.code === "PROJECT_LIMIT_REACHED") {
      throw new AppError(
        409,
        "PROJECT_LIMIT_REACHED",
        "This project has no open work, so this change would make it active again, and your plan has no free project slots. Finish or archive another project, or upgrade your plan.",
      );
    }
    throw error;
  }
}

export async function releaseProjectSlot(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  await Organization.findByIdAndUpdate(
    tenantId,
    { $inc: { projectCount: -1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });
}

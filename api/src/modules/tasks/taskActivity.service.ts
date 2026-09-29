import { TaskActivity } from "../../models/TaskActivity.js";
import { Task } from "../../models/Task.js";
import { Membership } from "../../models/Membership.js";
import { Notification } from "../../models/Notification.js";
import { User } from "../../models/User.js";
import { AppError } from "../../lib/errors.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import { can } from "../../auth/rbac.js";
import type { Role } from "../../constants/roles.js";
import type { CreateActivityInput } from "./tasks.schemas.js";
import mongoose from "mongoose";

export async function createActivity(
  taskId: string,
  input: CreateActivityInput,
) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  const task = await Task.findById(taskId);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  if (
    input.type === "update_request" &&
    !can(context.role as Role, "task:request-update")
  ) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only admins and managers can request updates",
    );
  }

  if (!can(context.role as Role, "task:comment")) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to post activity",
    );
  }

  if (input.type !== "update_request" && context.role === "member") {
    const isAssignee = task.assigneeIds?.some(
      (id) => id.toString() === context.userId,
    );
    if (!isAssignee) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Only assignees can post updates or questions on this task",
      );
    }
  }

  const author = await User.findById(context.userId).select("name");
  const authorName = author?.name ?? "Someone";

  const activity = await TaskActivity.create({
    taskId,
    projectId: task.projectId,
    authorId: context.userId,
    type: input.type,
    content: input.content,
  });

  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      if (input.type === "update_request") {
        const assigneeIds = task.assigneeIds ?? [];
        const notifications = assigneeIds.map((assigneeId) => ({
          userId: assigneeId,
          tenantId,
          taskId: task._id,
          activityId: activity._id,
          message: `${authorName} requested an update on "${task.title}"`,
        }));
        if (notifications.length > 0) {
          await Notification.insertMany(notifications, { session: dbSession });
        }
      } else {
        const adminManagers = await Membership.find({
          role: { $in: ["admin", "manager"] },
        })
          .select("userId")
          .lean();

        const typeLabel =
          input.type === "question" ? "a question" : "an update";
        const notifications = adminManagers.map((m) => ({
          userId: m.userId,
          tenantId,
          taskId: task._id,
          activityId: activity._id,
          message: `${authorName} posted ${typeLabel} on "${task.title}"`,
        }));
        if (notifications.length > 0) {
          await Notification.insertMany(notifications, { session: dbSession });
        }
      }
    });
  } finally {
    await dbSession.endSession();
  }

  return activity;
}

export async function listActivities(taskId: string) {
  const task = await Task.findById(taskId);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  const activities = await TaskActivity.find({ taskId })
    .sort({ _id: 1 })
    .lean();

  const authorIds = [...new Set(activities.map((a) => String(a.authorId)))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select("name email")
    .lean();
  const authorMap = new Map(authors.map((u) => [String(u._id), u]));

  return activities.map((a) => ({
    ...a,
    author: authorMap.get(String(a.authorId)) ?? null,
  }));
}

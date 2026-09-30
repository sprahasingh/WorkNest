import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Notification } from "../../models/Notification.js";
import { Project, binnedProjectIds } from "../../models/Project.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";

const PAGE_SIZE = 50;
const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;
const REMINDER_TYPES = ["task_due_soon", "task_overdue"] as const;

async function ensureMyDueNotifications(): Promise<void> {
  const context = getTenantContext()!;
  const tenantId = new mongoose.Types.ObjectId(requireTenantId());
  const userId = new mongoose.Types.ObjectId(context.userId);
  const now = new Date();
  const reminderWindowEnd = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const activeProjectIds = await Project.find({ archivedAt: null }).distinct(
    "_id",
  );
  if (activeProjectIds.length === 0) return;

  const tasks = await Task.find({
    projectId: { $in: activeProjectIds },
    status: { $in: ["todo", "in_progress"] },
    archivedAt: null,
    deletedAt: null,
    dueDate: { $ne: null, $lte: reminderWindowEnd },
    assigneeIds: userId,
  })
    .sort({ dueDate: 1 })
    .select("_id projectId title dueDate")
    .lean();

  if (tasks.length === 0) return;

  const operations = tasks.map((task) => {
    const dueDate = task.dueDate!;
    const type: (typeof REMINDER_TYPES)[number] =
      dueDate <= now ? "task_overdue" : "task_due_soon";
    const eventKey = `${task._id}:${type}:${dueDate.getTime()}`;
    return {
      updateOne: {
        filter: { userId, eventKey },
        update: {
          $setOnInsert: {
            userId,
            tenantId,
            projectId: task.projectId,
            taskId: task._id,
            dueDate,
            activityId: null,
            type,
            actorId: null,
            message:
              type === "task_overdue"
                ? `Task "${task.title}" is overdue`
                : `Task "${task.title}" is due soon`,
            eventKey,
            readAt: null,
            dismissedAt: null,
          },
        },
        upsert: true,
      },
    };
  });

  try {
    await Notification.bulkWrite(operations, { ordered: false });
  } catch (error) {
    const writeErrors = (error as { writeErrors?: { code?: number }[] })
      .writeErrors;
    if (
      !writeErrors?.length ||
      writeErrors.some((item) => item.code !== 11000)
    ) {
      throw error;
    }
  }
}

export async function listNotifications(status: "unread" | "all") {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  await ensureMyDueNotifications();
  const binnedTaskIds = (await Task.distinct("_id", {
    deletedAt: { $ne: null },
  })) as mongoose.Types.ObjectId[];
  // Notifications about projects in the bin come back if they're restored.
  const mine = {
    userId: context.userId,
    tenantId,
    projectId: { $nin: await binnedProjectIds() },
    taskId: { $nin: binnedTaskIds },
  };

  const [notifications, unreadCount, readableUnreadCount] = await Promise.all([
    Notification.find(
      status === "unread" ? { ...mine, readAt: null, dismissedAt: null } : mine,
    )
      .sort({ _id: -1 })
      .limit(PAGE_SIZE)
      .lean(),
    Notification.countDocuments({ ...mine, readAt: null, dismissedAt: null }),
    Notification.countDocuments({
      ...mine,
      readAt: null,
      dismissedAt: null,
      type: { $nin: REMINDER_TYPES },
    }),
  ]);

  const projectIds = [
    ...new Set(
      notifications
        .map((n) => n.projectId?.toString())
        .filter((id): id is string => !!id),
    ),
  ];
  const projects = await Project.find({ _id: { $in: projectIds } })
    .select("name")
    .lean();
  const projectNames = new Map(projects.map((p) => [String(p._id), p.name]));

  return {
    notifications: notifications.map((n) => ({
      ...n,
      projectName: n.projectId
        ? (projectNames.get(String(n.projectId)) ?? null)
        : null,
    })),
    unreadCount,
    readableUnreadCount,
  };
}

export async function markNotificationsRead(ids?: string[]) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  const filter: Record<string, unknown> = {
    userId: context.userId,
    tenantId,
    readAt: null,
    type: { $nin: REMINDER_TYPES },
  };

  if (ids?.length) {
    filter._id = { $in: ids };
  }

  await Notification.updateMany(filter, { readAt: new Date() });
}

export async function dismissTaskNotifications(ids: string[]) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  await Notification.updateMany(
    {
      _id: { $in: ids },
      userId: context.userId,
      tenantId,
      type: { $in: REMINDER_TYPES },
      dismissedAt: null,
    },
    { dismissedAt: new Date() },
  );
}

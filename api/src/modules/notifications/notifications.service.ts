import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Notification } from "../../models/Notification.js";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { Project, binnedProjectIds } from "../../models/Project.js";
import { dateStartInTimeZone } from "../../lib/timezone.js";
import {
  getTenantContext,
  requireTenantId,
  runWithTenant,
} from "../../tenancy/context.js";

const PAGE_SIZE = 50;
const DUE_SOON_48H_WINDOW_MS = 48 * 60 * 60 * 1000;
const REMINDER_TYPES = [
  "task_due_soon",
  "task_overdue",
  "project_due_soon",
  "project_overdue",
] as const;
let reminderSweepRunning = false;

async function ensureMyDueNotifications(): Promise<void> {
  const context = getTenantContext()!;
  const tenantId = new mongoose.Types.ObjectId(requireTenantId());
  const userId = new mongoose.Types.ObjectId(context.userId);
  const now = new Date();
  const [membership, organization] = await Promise.all([
    Membership.findOne({ userId }).select("role").lean(),
    Organization.findById(tenantId).select("timeZone").lean(),
  ]);
  const isManager = membership?.role === "manager";
  const isAdmin = membership?.role === "admin";
  const isPrivileged = isManager || isAdmin;
  const timeZone = organization?.timeZone ?? "UTC";
  const reminderWindowEnd = new Date(now.getTime() + DUE_SOON_48H_WINDOW_MS);
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
    ...(isPrivileged ? {} : { assigneeIds: userId }),
  })
    .sort({ dueDate: 1 })
    .select("_id projectId title dueDate assigneeIds reminderCycle")
    .lean();

  const getDueSoonEventKey = (
    task: (typeof tasks)[number],
    phase: "48h" | "24h",
  ) => {
    const dueDate = task.dueDate!;
    const cycleSuffix = task.reminderCycle
      ? `:cycle:${task.reminderCycle}`
      : "";
    const baseEventKey = `${task._id}:task_due_soon:${dueDate.getTime()}${cycleSuffix}`;
    return phase === "48h" && !isManager
      ? `${baseEventKey}:48h`
      : phase === "24h" && isManager
        ? `${baseEventKey}:24h`
        : baseEventKey;
  };

  const dueToday48HourEventKeys = tasks.flatMap((task) => {
    const dueDate = task.dueDate!;
    const isAssignee = task.assigneeIds.some((assigneeId) =>
      assigneeId.equals(userId),
    );
    return isAssignee &&
      dueDate > now &&
      dateStartInTimeZone(dueDate, timeZone) <= now
      ? [getDueSoonEventKey(task, "48h")]
      : [];
  });
  if (dueToday48HourEventKeys.length > 0) {
    await Notification.updateMany(
      {
        userId,
        tenantId,
        type: "task_due_soon",
        eventKey: { $in: dueToday48HourEventKeys },
        dismissedAt: null,
      },
      { dismissedAt: now },
    );
  }

  const overdueTaskIds = tasks
    .filter((task) => task.dueDate! <= now)
    .map((task) => task._id);
  if (overdueTaskIds.length > 0) {
    await Notification.updateMany(
      {
        userId,
        tenantId,
        taskId: { $in: overdueTaskIds },
        type: "task_due_soon",
        dismissedAt: null,
      },
      { dismissedAt: now },
    );
  }

  const operations = tasks.flatMap((task) => {
    const dueDate = task.dueDate!;
    const isAssignee = task.assigneeIds.some((assigneeId) =>
      assigneeId.equals(userId),
    );
    const dueSoonPhases = new Set<"48h" | "24h">();
    const reminders: {
      type: (typeof REMINDER_TYPES)[number];
      phase?: "48h" | "24h";
    }[] = [];

    if (dueDate <= now && (isAssignee || isPrivileged)) {
      reminders.push({ type: "task_overdue" });
    } else if (dueDate > now) {
      const timeUntilDue = dueDate.getTime() - now.getTime();
      const isDueToday = dateStartInTimeZone(dueDate, timeZone) <= now;
      const hasAssigneeDueToday = isAssignee && isDueToday;
      if (
        isManager &&
        timeUntilDue <= DUE_SOON_48H_WINDOW_MS &&
        !hasAssigneeDueToday
      ) {
        dueSoonPhases.add("48h");
      }
      if (isAssignee) {
        if (hasAssigneeDueToday) {
          dueSoonPhases.add("24h");
        } else if (timeUntilDue <= DUE_SOON_48H_WINDOW_MS) {
          dueSoonPhases.add("48h");
        }
      }
      reminders.push(
        ...Array.from(dueSoonPhases, (phase) => ({
          type: "task_due_soon" as const,
          phase,
        })),
      );
    }

    return reminders.map(({ type, phase }) => {
      const cycleSuffix = task.reminderCycle
        ? `:cycle:${task.reminderCycle}`
        : "";
      const baseEventKey = `${task._id}:${type}:${dueDate.getTime()}${cycleSuffix}`;
      const eventKey =
        type === "task_due_soon" && phase
          ? getDueSoonEventKey(task, phase)
          : baseEventKey;
      const message =
        type === "task_overdue"
          ? `Task "${task.title}" is overdue`
          : phase === "24h"
            ? `Task "${task.title}" is due today`
            : `Task "${task.title}" is due soon`;
      return {
        updateOne: {
          filter: { userId, eventKey },
          update: {
            $set: { message },
            $setOnInsert: {
              userId,
              tenantId,
              projectId: task.projectId,
              taskId: task._id,
              dueDate,
              activityId: null,
              type,
              actorId: null,
              eventKey,
              readAt: null,
              dismissedAt: null,
            },
          },
          upsert: true,
        },
      };
    });
  });

  try {
    if (operations.length > 0) {
      await Notification.bulkWrite(operations, { ordered: false });
    }
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

  const projects = await Project.find({
    archivedAt: null,
    dueDate: { $ne: null, $lte: reminderWindowEnd },
  })
    .sort({ dueDate: 1 })
    .select("_id name dueDate reminderCycle")
    .lean();

  const dueTodayProjectEventKeys = projects.flatMap((project) => {
    const dueDate = project.dueDate!;
    const cycleSuffix = project.reminderCycle
      ? `:cycle:${project.reminderCycle}`
      : "";
    const baseEventKey = `${project._id}:project_due_soon:${dueDate.getTime()}${cycleSuffix}`;
    return dueDate > now && dateStartInTimeZone(dueDate, timeZone) <= now
      ? [`${baseEventKey}:48h`]
      : [];
  });
  if (dueTodayProjectEventKeys.length > 0) {
    await Notification.updateMany(
      {
        userId,
        tenantId,
        type: "project_due_soon",
        eventKey: { $in: dueTodayProjectEventKeys },
        dismissedAt: null,
      },
      { dismissedAt: now },
    );
  }

  const overdueProjectIds = projects
    .filter((project) => project.dueDate! <= now)
    .map((project) => project._id);
  if (overdueProjectIds.length > 0) {
    await Notification.updateMany(
      {
        userId,
        tenantId,
        projectId: { $in: overdueProjectIds },
        type: "project_due_soon",
        dismissedAt: null,
      },
      { dismissedAt: now },
    );
  }

  const projectOperations = projects.map((project) => {
    const dueDate = project.dueDate!;
    const cycleSuffix = project.reminderCycle
      ? `:cycle:${project.reminderCycle}`
      : "";
    const isOverdue = dueDate <= now;
    const isDueToday = dateStartInTimeZone(dueDate, timeZone) <= now;
    const type: "project_due_soon" | "project_overdue" = isOverdue
      ? "project_overdue"
      : "project_due_soon";
    const eventKey = isOverdue
      ? `${project._id}:${type}:${dueDate.getTime()}${cycleSuffix}`
      : `${project._id}:${type}:${dueDate.getTime()}${cycleSuffix}:${isDueToday ? "24h" : "48h"}`;
    const message = isOverdue
      ? `Project "${project.name}" is overdue`
      : `Project "${project.name}" is due ${isDueToday ? "today" : "soon"}`;

    return {
      updateOne: {
        filter: { userId, eventKey },
        update: {
          $set: { message },
          $setOnInsert: {
            userId,
            tenantId,
            projectId: project._id,
            taskId: null,
            dueDate,
            activityId: null,
            type,
            actorId: null,
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
    if (projectOperations.length > 0) {
      await Notification.bulkWrite(projectOperations, { ordered: false });
    }
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

export async function ensureDueNotificationsForAllUsers(): Promise<void> {
  if (reminderSweepRunning) return;
  reminderSweepRunning = true;

  try {
    const organizations = await Organization.collection
      .find({}, { projection: { _id: 1 } })
      .toArray();

    for (const organization of organizations) {
      const memberships = await Membership.collection
        .find(
          { tenantId: organization._id },
          { projection: { userId: 1, role: 1 } },
        )
        .toArray();

      for (const membership of memberships) {
        await runWithTenant(
          {
            tenantId: String(organization._id),
            userId: String(membership.userId),
            role: String(membership.role),
          },
          ensureMyDueNotifications,
        );
      }
    }
  } finally {
    reminderSweepRunning = false;
  }
}

export async function listNotifications(status: "unread" | "all") {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  await ensureMyDueNotifications();
  const [binnedTaskIds, archivedProjectIds] = (await Promise.all([
    Task.distinct("_id", { deletedAt: { $ne: null } }),
    Project.find({ archivedAt: { $ne: null } }).distinct("_id"),
  ])) as [mongoose.Types.ObjectId[], mongoose.Types.ObjectId[]];
  // Notifications for binned tasks and archived projects return when restored.
  const mine = {
    userId: context.userId,
    tenantId,
    projectId: { $nin: [...(await binnedProjectIds()), ...archivedProjectIds] },
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

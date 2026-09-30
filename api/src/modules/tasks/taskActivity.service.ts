import mongoose from "mongoose";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Task } from "../../models/Task.js";
import { Project } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
import { Notification } from "../../models/Notification.js";
import { User } from "../../models/User.js";
import { AppError } from "../../lib/errors.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import { can } from "../../auth/rbac.js";
import { isTaskAssignee } from "../../auth/ownership.js";
import type { Role } from "../../constants/roles.js";
import type { ActivityType, CreateActivityInput } from "./tasks.schemas.js";
import {
  assertTaskVisible,
  findTaskInLiveProject,
  memberVisibilityFilter,
} from "./tasks.service.js";

const PROJECT_FEED_LIMIT = 100;

type Id = mongoose.Types.ObjectId | string;

const LEAD_ONLY_TYPES: ActivityType[] = ["update_request", "reply"];

function isLead(): boolean {
  const context = getTenantContext()!;
  return can(context.role as Role, "task:request-update");
}

function assertCanPostLeadActivity(type: ActivityType): void {
  if (LEAD_ONLY_TYPES.includes(type) && !isLead()) {
    throw new AppError(
      403,
      "FORBIDDEN",
      type === "update_request"
        ? "Only admins and managers can request updates"
        : "Only admins and managers can reply to updates",
    );
  }
}

async function getAdminAndManagerIds(): Promise<Id[]> {
  const memberships = await Membership.find({
    role: { $in: ["admin", "manager"] },
  })
    .select("userId")
    .lean();
  return memberships.map((m) => m.userId);
}

async function getAuthorName(userId: string): Promise<string> {
  const author = await User.findById(userId).select("name");
  return author?.name ? String(author.name) : "Someone";
}

async function recordActivity(options: {
  projectId: Id;
  taskId: Id | null;
  input: CreateActivityInput;
  recipients: Id[];
  message: string;
}) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  const recipientIds = [
    ...new Set(options.recipients.map((id) => id.toString())),
  ].filter((id) => id !== context.userId);

  const dbSession = await mongoose.startSession();
  try {
    let activity;
    await dbSession.withTransaction(async () => {
      const [created] = await TaskActivity.create(
        [
          {
            projectId: options.projectId,
            taskId: options.taskId,
            authorId: context.userId,
            type: options.input.type,
            content: options.input.content,
          },
        ],
        { session: dbSession },
      );

      if (recipientIds.length > 0) {
        await Notification.insertMany(
          recipientIds.map((userId) => ({
            userId,
            tenantId,
            projectId: options.projectId,
            taskId: options.taskId,
            activityId: created._id,
            type: options.input.type,
            actorId: context.userId,
            message: options.message,
          })),
          { session: dbSession },
        );
      }

      activity = created;
    });
    return { activity: activity!, notifiedCount: recipientIds.length };
  } finally {
    await dbSession.endSession();
  }
}

async function withAuthors<T extends { authorId: Id }>(activities: T[]) {
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

export async function createTaskActivity(
  taskId: string,
  input: CreateActivityInput,
) {
  const context = getTenantContext()!;
  const task = await findTaskInLiveProject(taskId);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }
  await assertTaskVisible(task);
  assertCanPostLeadActivity(input.type);

  if (!isLead() && !isTaskAssignee(task, context.userId)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only assignees can post updates or questions on this task",
    );
  }

  const authorName = await getAuthorName(context.userId);
  const messages: Record<ActivityType, string> = {
    update_request: `${authorName} requested an update on "${task.title}"`,
    reply: `${authorName} replied on "${task.title}"`,
    update: `${authorName} posted an update on "${task.title}"`,
    question: `${authorName} asked a question on "${task.title}"`,
  };

  const assignees = task.assigneeIds ?? [];
  if (input.type === "update_request" && assignees.length === 0) {
    throw new AppError(
      400,
      "NO_ASSIGNEES",
      "Assign someone to this task before requesting an update",
    );
  }

  // Requests and replies go to the people doing the work. Updates and
  // questions go to admins and managers, and to the task's other assignees
  // so everyone on the task stays in the loop.
  const recipients = LEAD_ONLY_TYPES.includes(input.type)
    ? assignees
    : [...(await getAdminAndManagerIds()), ...assignees];

  const { activity } = await recordActivity({
    projectId: task.projectId,
    taskId: task._id,
    input,
    recipients,
    message: messages[input.type],
  });
  return activity;
}

export async function listTaskActivities(taskId: string) {
  const task = await findTaskInLiveProject(taskId);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }
  await assertTaskVisible(task);

  const activities = await TaskActivity.find({ taskId })
    .sort({ _id: 1 })
    .lean();
  return withAuthors(activities);
}

export async function createProjectActivity(
  projectId: string,
  input: CreateActivityInput,
) {
  const context = getTenantContext()!;
  const project = await Project.findById(projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }
  assertCanPostLeadActivity(input.type);

  if (!isLead()) {
    const assignedHere = await Task.exists({
      projectId,
      assigneeIds: new mongoose.Types.ObjectId(context.userId),
    });
    if (!assignedHere) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Only people assigned to a task in this project can post here",
      );
    }
  }

  let recipients: Id[];
  if (LEAD_ONLY_TYPES.includes(input.type)) {
    const openTasks = await Task.find({
      projectId,
      status: { $ne: "done" },
      archivedAt: null,
      deletedAt: null,
    })
      .select("assigneeIds")
      .lean();
    recipients = openTasks.flatMap((t) => t.assigneeIds ?? []);

    if (input.type === "update_request" && recipients.length === 0) {
      throw new AppError(
        400,
        "NO_ASSIGNEES",
        "No open task in this project has an assignee to ask for an update",
      );
    }
  } else {
    recipients = await getAdminAndManagerIds();
  }

  const authorName = await getAuthorName(context.userId);
  const messages: Record<ActivityType, string> = {
    update_request: `${authorName} requested updates on your tasks in "${project.name}"`,
    reply: `${authorName} replied in "${project.name}"`,
    update: `${authorName} posted an update on "${project.name}"`,
    question: `${authorName} asked a question about "${project.name}"`,
  };

  return recordActivity({
    projectId: project._id,
    taskId: null,
    input,
    recipients,
    message: messages[input.type],
  });
}

// Everything said in a project: project-wide posts plus every task's
// updates, each labelled with its task. Members only get task activity for
// tasks they're allowed to see.
export async function listProjectActivities(projectId: string) {
  const context = getTenantContext()!;
  const project = await Project.findById(projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const taskFilter: Record<string, unknown> = { projectId };
  if (context.role === "member") {
    taskFilter.$and = [await memberVisibilityFilter(context.userId)];
  }
  const tasks = await Task.find(taskFilter).select("title").lean();
  const taskTitles = new Map(tasks.map((t) => [String(t._id), t.title]));

  const activities = await TaskActivity.find({
    projectId,
    $or: [{ taskId: null }, { taskId: { $in: [...taskTitles.keys()] } }],
  })
    .sort({ _id: -1 })
    .limit(PROJECT_FEED_LIMIT)
    .lean();

  const withTask = activities.reverse().map((a) => ({
    ...a,
    task: a.taskId
      ? { _id: String(a.taskId), title: taskTitles.get(String(a.taskId))! }
      : null,
  }));
  return withAuthors(withTask);
}

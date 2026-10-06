import mongoose, { type HydratedDocument } from "mongoose";
import {
  TaskActivity,
  type TaskActivityDocument,
} from "../../models/TaskActivity.js";
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
import type {
  ActivityType,
  CreateActivityInput,
  MarkAnswerInput,
} from "./tasks.schemas.js";
import {
  creatorIfInvolved,
  getAdminAndManagerIds,
  mutedAmong,
} from "../notifications/audience.js";
import {
  assertTaskVisible,
  findTaskInLiveProject,
  memberVisibilityFilter,
} from "./tasks.service.js";

const PROJECT_FEED_LIMIT = 100;

type Id = mongoose.Types.ObjectId | string;

// Asking for updates is for admins and managers. Anyone who can take part
// in a conversation can post updates, ask questions and reply.
const LEAD_ONLY_TYPES: ActivityType[] = ["update_request"];

function isLead(): boolean {
  const context = getTenantContext()!;
  return can(context.role as Role, "task:request-update");
}

function assertCanPostLeadActivity(type: ActivityType): void {
  if (LEAD_ONLY_TYPES.includes(type) && !isLead()) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only admins and managers can request updates",
    );
  }
}

// Who a mention reaches. Whole-role mentions are for admins and managers
// only, and on a task, mentions only reach people who can see it, so nobody
// is told about work they can't open.
async function getMentionRecipients(
  input: CreateActivityInput,
  assigneeIds: Id[],
  task: { assigneeIds?: Id[] | null } | null,
): Promise<Id[]> {
  const roleMentions = [...new Set(input.mentionRoles ?? [])];
  const mentionedIds = [...new Set(input.mentionMemberIds ?? [])].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  if (mentionedIds.length === 0 && roleMentions.length === 0) return [];

  const mentionedRoles = roleMentions.filter((role) => role !== "assignee");
  if (mentionedRoles.length > 0 && !isLead()) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only admins and managers can mention a whole role",
    );
  }

  let memberships: Array<{ userId: Id; role: string }> = [];
  if (mentionedIds.length > 0 || mentionedRoles.length > 0) {
    memberships = await Membership.find({
      $or: [
        ...(mentionedIds.length > 0 ? [{ userId: { $in: mentionedIds } }] : []),
        ...(mentionedRoles.length > 0
          ? [{ role: { $in: mentionedRoles } }]
          : []),
      ],
    })
      .select("userId role")
      .lean();
  }
  const foundIds = new Set(
    memberships.map((membership) => String(membership.userId)),
  );
  const missingIds = mentionedIds.filter((id) => !foundIds.has(String(id)));
  if (missingIds.length > 0) {
    throw new AppError(
      400,
      "INVALID_MENTION",
      "A mentioned person is no longer a member of this workspace",
    );
  }

  // A task assigned to an admin or manager is hidden from other members.
  const taskAssigneeIds = new Set(
    (task?.assigneeIds ?? []).map((id) => String(id)),
  );
  const leadIds = task
    ? new Set((await getAdminAndManagerIds()).map((id) => String(id)))
    : new Set<string>();
  const hiddenFromMembers =
    task !== null && [...taskAssigneeIds].some((id) => leadIds.has(id));
  const canSee = (membership: { userId: Id; role: string }) =>
    !hiddenFromMembers ||
    membership.role !== "member" ||
    taskAssigneeIds.has(String(membership.userId));

  const explicitlyMentioned = new Set(mentionedIds.map((id) => String(id)));
  const blocked = memberships.filter(
    (membership) =>
      explicitlyMentioned.has(String(membership.userId)) && !canSee(membership),
  );
  if (blocked.length > 0) {
    throw new AppError(
      400,
      "INVALID_MENTION",
      "A mentioned member can't see this task because it's assigned to an admin or manager",
    );
  }

  return [
    ...memberships.filter(canSee).map((membership) => membership.userId),
    ...(roleMentions.includes("assignee") ? assigneeIds : []),
  ];
}

async function getAuthorName(userId: string): Promise<string> {
  const author = await User.findById(userId).select("name");
  return author?.name ? String(author.name) : "Someone";
}

function getNotificationRecipients(recipients: Id[], authorId: string): Id[] {
  return [
    ...new Map(recipients.map((id) => [id.toString(), id])).values(),
  ].filter((id) => id.toString() !== authorId);
}

// Who to notify and what to tell them. Groups are listed most specific
// first; someone in several groups gets only the first group's message.
interface NotifyGroup {
  recipients: Id[];
  message: string;
  // General chatter, which muting the project or task silences. Anything
  // addressed to the person (a mention, a reply to them, a request) isn't.
  mutable?: boolean;
}

// Works out each recipient's message: the first group that reaches them
// wins, and people who muted this project or task skip the mutable groups,
// so a later group addressed to them can still reach them.
async function resolveRecipients(
  groups: NotifyGroup[],
  authorId: string,
  projectId: Id,
  taskId: Id | null,
): Promise<Map<string, string>> {
  const mutableIds = groups
    .filter((group) => group.mutable)
    .flatMap((group) => group.recipients);
  const everyone = getNotificationRecipients(
    groups.flatMap((group) => group.recipients),
    authorId,
  );
  // People who have left the organization can't open anything here.
  const [muted, members] = await Promise.all([
    mutedAmong(mutableIds, projectId, taskId),
    Membership.find({ userId: { $in: everyone } })
      .select("userId")
      .lean(),
  ]);
  const memberIds = new Set(members.map((m) => String(m.userId)));
  const messageFor = new Map<string, string>();
  for (const group of groups) {
    for (const id of getNotificationRecipients(group.recipients, authorId)) {
      const key = id.toString();
      if (messageFor.has(key) || !memberIds.has(key)) continue;
      if (group.mutable && muted.has(key)) continue;
      messageFor.set(key, group.message);
    }
  }
  return messageFor;
}

// A few names so the sender can see who was told.
async function summarizeRecipients(recipientIds: string[]) {
  const named = await User.find({ _id: { $in: recipientIds.slice(0, 3) } })
    .select("name")
    .lean();
  const nameById = new Map(named.map((u) => [String(u._id), u.name]));
  return {
    notifiedCount: recipientIds.length,
    notifiedNames: recipientIds
      .slice(0, 3)
      .map((id) => nameById.get(id))
      .filter((name): name is string => !!name),
  };
}

async function recordActivity(options: {
  projectId: Id;
  taskId: Id | null;
  input: CreateActivityInput;
  mentionIds: Id[];
  notify: NotifyGroup[];
  parentId?: Id | null;
  replyToId?: Id | null;
  askedIds?: Id[];
  notifyAll?: boolean;
  projectIds?: Id[];
  projectNames?: string[];
  sharedParticipantIds?: Id[];
}) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();

  const messageFor = await resolveRecipients(
    options.notify,
    context.userId,
    options.projectId,
    options.taskId,
  );
  const recipientIds = [...messageFor.keys()];

  const dbSession = await mongoose.startSession();
  try {
    let activity;
    await dbSession.withTransaction(async () => {
      const [created] = await TaskActivity.create(
        [
          {
            projectId: options.projectId,
            ...(options.projectIds ? { projectIds: options.projectIds } : {}),
            ...(options.projectNames
              ? { projectNames: options.projectNames }
              : {}),
            ...(options.sharedParticipantIds
              ? { sharedParticipantIds: options.sharedParticipantIds }
              : {}),
            taskId: options.taskId,
            authorId: context.userId,
            type: options.input.type,
            content: options.input.content,
            mentionIds: getNotificationRecipients(
              options.mentionIds,
              context.userId,
            ),
            parentId: options.parentId ?? null,
            replyToId: options.replyToId ?? null,
            askedIds: getNotificationRecipients(
              options.askedIds ?? [],
              context.userId,
            ),
            notifyAll: options.notifyAll ?? true,
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
            message: messageFor.get(userId)!,
          })),
          { session: dbSession },
        );
      }

      activity = created;
    });

    return {
      activity: activity!,
      ...(await summarizeRecipients(recipientIds)),
    };
  } finally {
    await dbSession.endSession();
  }
}

function sameId(left: Id | null | undefined, right: Id): boolean {
  return !!left && String(left) === String(right);
}

async function openTaskAssigneeIds(projectId: Id): Promise<Id[]> {
  const openTasks = await Task.find({
    projectId,
    status: { $ne: "done" },
    archivedAt: null,
    deletedAt: null,
  })
    .select("assigneeIds")
    .lean();
  return openTasks.flatMap((task) => task.assigneeIds ?? []);
}

const THREAD_NAMES: Record<ActivityType, string> = {
  update_request: "update request",
  update: "update",
  question: "question",
  reply: "message",
};

// How long the requester waits between reminders to people who haven't
// replied to an update request.
export const REMIND_COOLDOWN_MS = 60 * 60 * 1000;

type ActivityDoc = HydratedDocument<TaskActivityDocument>;

// A message sent only to the people mentioned in it. Its thread stays
// between them and the author. A message sent to nobody (no mentions, not
// sent to everyone) is just a quiet note, and anyone involved can reply.
function isDirected(root: {
  notifyAll?: boolean | null;
  mentionIds?: Id[] | null;
}): boolean {
  return root.notifyAll === false && (root.mentionIds?.length ?? 0) > 0;
}

// Everyone taking part in a thread: who started it, who it was sent to or
// asked, and whoever has replied or been mentioned in a reply since.
function threadParticipants(
  root: {
    authorId: Id;
    mentionIds?: Id[] | null;
    askedIds?: Id[] | null;
    sharedParticipantIds?: Id[] | null;
  },
  replies: Array<{ authorId: Id; mentionIds?: Id[] | null }>,
): Set<string> {
  return new Set(
    [
      root.authorId,
      ...(root.mentionIds ?? []),
      ...(root.askedIds ?? []),
      ...(root.sharedParticipantIds ?? []),
      ...replies.flatMap((reply) => [
        reply.authorId,
        ...(reply.mentionIds ?? []),
      ]),
    ].map((id) => String(id)),
  );
}

// A message sent only to particular people stays between them and the author,
// and so does its thread. Everyone else who can see the task or project must
// not be able to read it either, not just be unable to reply.
function withoutOthersDirectedThreads<
  T extends {
    _id: Id;
    parentId?: Id | null;
    authorId: Id;
    notifyAll?: boolean | null;
    mentionIds?: Id[] | null;
    askedIds?: Id[] | null;
  },
>(activities: T[], me: string): T[] {
  const repliesByRoot = new Map<string, T[]>();
  for (const activity of activities) {
    if (!activity.parentId) continue;
    const key = String(activity.parentId);
    repliesByRoot.set(key, [...(repliesByRoot.get(key) ?? []), activity]);
  }
  const hidden = new Set<string>();
  for (const root of activities) {
    if (root.parentId || !isDirected(root)) continue;
    const replies = repliesByRoot.get(String(root._id)) ?? [];
    if (!threadParticipants(root, replies).has(me)) {
      hidden.add(String(root._id));
    }
  }
  return activities.filter(
    (activity) =>
      !hidden.has(String(activity._id)) &&
      !(activity.parentId && hidden.has(String(activity.parentId))),
  );
}

// Finds a message and the one that started its thread, making sure both
// belong to the task or project in the URL. A project's feed shows its
// tasks' messages too, so they count as part of the project.
async function loadThread(
  scope: { taskId: string } | { projectId: string },
  activityId: string | undefined,
  missingMessage: string,
): Promise<{ target: ActivityDoc; root: ActivityDoc }> {
  const notFound = new AppError(404, "NOT_FOUND", missingMessage);
  if (!activityId || !mongoose.isValidObjectId(activityId)) throw notFound;
  const target = await TaskActivity.findById(activityId);
  if (!target) throw notFound;
  const root = target.parentId
    ? await TaskActivity.findById(target.parentId)
    : target;
  if (!root) throw notFound;
  if ("taskId" in scope && !sameId(root.taskId, scope.taskId)) throw notFound;
  if (
    "projectId" in scope &&
    !sameId(root.projectId, scope.projectId) &&
    !(root.projectIds ?? []).some((id) =>
      sameId(id, new mongoose.Types.ObjectId(scope.projectId)),
    )
  ) {
    throw notFound;
  }
  return { target, root };
}

// Where a thread lives, checking the caller can still see it.
async function threadPlace(root: ActivityDoc, missingMessage: string) {
  const notFound = new AppError(404, "NOT_FOUND", missingMessage);
  if (root.taskId) {
    const task = await findTaskInLiveProject(String(root.taskId));
    if (!task) throw notFound;
    await assertTaskVisible(task);
    return { task, project: null, where: `on "${task.title}"` };
  }
  const project = await Project.findById(root.projectId);
  if (!project) throw notFound;
  const where = root.projectIds?.length
    ? `across ${root.projectNames?.length ?? root.projectIds.length} active projects`
    : `in "${project.name}"`;
  return { task: null, project, where };
}

// A reply to a specific message. It tells the person being answered, whoever
// started the thread, and everyone else already taking part in it, rather
// than everyone on the task. Replies to replies join the same thread, so
// threads stay one level deep.
async function createReply(
  scope: { taskId: string } | { projectId: string },
  input: CreateActivityInput,
) {
  const me = getTenantContext()!.userId;
  const missing = "The message you're replying to no longer exists";
  const { target, root } = await loadThread(scope, input.replyToId, missing);
  const { task, project, where } = await threadPlace(root, missing);

  const replies = await TaskActivity.find({ parentId: root._id })
    .select("authorId mentionIds")
    .lean();
  const participants = threadParticipants(root, replies);
  const meId = new mongoose.Types.ObjectId(me);

  // A message sent to particular people stays between them and the author.
  // Otherwise anyone who can join the task's or project's conversation can.
  let canReply: boolean;
  if (isDirected(root)) {
    canReply = participants.has(me);
  } else if (task) {
    canReply =
      isLead() ||
      participants.has(me) ||
      isTaskAssignee(task, me) ||
      !!(await TaskActivity.exists({ taskId: task._id, mentionIds: meId }));
  } else {
    canReply =
      isLead() ||
      participants.has(me) ||
      (root.sharedParticipantIds ?? []).some((id) => sameId(id, meId)) ||
      !!(await Task.exists({ projectId: project!._id, assigneeIds: meId })) ||
      !!(await TaskActivity.exists({
        projectId: project!._id,
        taskId: null,
        mentionIds: meId,
      }));
  }
  if (!canReply) {
    throw new AppError(
      403,
      "FORBIDDEN",
      isDirected(root)
        ? "Only the people this message was sent to can reply"
        : `Only people taking part in this ${task ? "task" : "project"}'s conversation can reply`,
    );
  }

  const mentionIds = task
    ? await getMentionRecipients(input, task.assigneeIds ?? [], task)
    : await getMentionRecipients(
        input,
        input.mentionRoles?.includes("assignee")
          ? await openTaskAssigneeIds(project!._id)
          : [],
        null,
      );

  const name = await getAuthorName(me);
  const answered =
    target.type === "question"
      ? `${name} answered your question ${where}`
      : target.type === "reply"
        ? `${name} replied to you ${where}`
        : `${name} replied to your ${THREAD_NAMES[target.type]} ${where}`;
  const threadName = THREAD_NAMES[root.type];

  return recordActivity({
    projectId: root.projectId,
    taskId: root.taskId ?? null,
    input,
    mentionIds,
    parentId: root._id,
    replyToId: target._id,
    notify: [
      { recipients: [target.authorId], message: answered },
      {
        recipients: [root.authorId],
        message: `${name} replied in your ${threadName} thread ${where}`,
      },
      { recipients: mentionIds, message: `${name} mentioned you ${where}` },
      // Everyone else in the thread hears about new replies, so a
      // conversation can carry on. Answers to an update request are each
      // their own, so the people asked aren't told about each other's.
      {
        recipients: root.type === "update_request" ? [] : [...participants],
        message: `${name} replied in a ${threadName} thread you're in ${where}`,
        mutable: true,
      },
    ],
  });
}

// The person who asked a question picks the reply that answered it, or
// clears it again.
export async function markAnswer(
  scope: { taskId: string } | { projectId: string },
  activityId: string,
  input: MarkAnswerInput,
) {
  const me = getTenantContext()!.userId;
  const missing = "That question no longer exists";
  const { target: question } = await loadThread(scope, activityId, missing);
  if (question.parentId || question.type !== "question") {
    throw new AppError(
      400,
      "NOT_A_QUESTION",
      "Only questions can be marked as answered",
    );
  }
  await threadPlace(question, missing);
  if (!sameId(question.authorId, me)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the person who asked can mark the answer",
    );
  }
  if (input.answerId) {
    const reply = await TaskActivity.exists({
      _id: input.answerId,
      parentId: question._id,
    });
    if (!reply) {
      throw new AppError(
        400,
        "INVALID_ANSWER",
        "Pick a reply from this question's thread",
      );
    }
  }
  question.answerId = input.answerId
    ? new mongoose.Types.ObjectId(input.answerId)
    : null;
  await question.save();
  return question.toObject();
}

// Nudges the people an update request is still waiting on, at most once an
// hour, without pinging those who already replied.
export async function remindWaiting(
  scope: { taskId: string } | { projectId: string },
  activityId: string,
) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const missing = "That update request no longer exists";
  const { target: request } = await loadThread(scope, activityId, missing);
  if (request.parentId || request.type !== "update_request") {
    throw new AppError(
      400,
      "NOT_A_REQUEST",
      "Only update requests can be followed up with a reminder",
    );
  }
  const { where } = await threadPlace(request, missing);
  if (!sameId(request.authorId, context.userId)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the person who asked can send a reminder",
    );
  }

  const replies = await TaskActivity.find({ parentId: request._id })
    .select("authorId")
    .lean();
  const replied = new Set(replies.map((reply) => String(reply.authorId)));
  const waiting = (request.askedIds ?? []).filter(
    (id) => !replied.has(String(id)),
  );
  if (waiting.length === 0) {
    throw new AppError(
      400,
      "NOTHING_TO_REMIND",
      "Everyone you asked has already replied",
    );
  }

  const name = await getAuthorName(context.userId);
  const messageFor = await resolveRecipients(
    [
      {
        recipients: waiting,
        message: `${name} is still waiting on your update ${where}`,
      },
    ],
    context.userId,
    request.projectId,
    request.taskId ?? null,
  );
  const recipientIds = [...messageFor.keys()];
  if (recipientIds.length === 0) {
    throw new AppError(
      400,
      "NOTHING_TO_REMIND",
      "The people still to reply are no longer in this workspace",
    );
  }

  // Claimed atomically, so two clicks can't both send a reminder.
  const now = new Date();
  const claimed = await TaskActivity.findOneAndUpdate(
    {
      _id: request._id,
      $or: [
        { remindedAt: null },
        { remindedAt: { $lte: new Date(now.getTime() - REMIND_COOLDOWN_MS) } },
      ],
    },
    { $set: { remindedAt: now } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const nextAt = request.remindedAt!.getTime() + REMIND_COOLDOWN_MS;
    const minutes = Math.max(1, Math.ceil((nextAt - now.getTime()) / 60000));
    throw new AppError(
      429,
      "REMIND_TOO_SOON",
      `You've just sent a reminder. You can send another in ${minutes} min.`,
    );
  }

  await Notification.insertMany(
    recipientIds.map((userId) => ({
      userId,
      tenantId,
      projectId: request.projectId,
      taskId: request.taskId ?? null,
      activityId: request._id,
      type: "update_request" as const,
      actorId: context.userId,
      message: messageFor.get(userId)!,
    })),
  );

  return {
    remindedAt: now,
    ...(await summarizeRecipients(recipientIds)),
  };
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

// Who a new message reaches. By default it goes to everyone involved and
// anyone mentioned. With notifyAll off it goes only to the people mentioned,
// and if nobody is, it's posted quietly. An update request asks the same
// people it reaches.
function planNewMessage(options: {
  input: CreateActivityInput;
  authorId: string;
  // Who an update request asks by default: the people doing the work.
  workers: Id[];
  // Also told about updates and questions sent to everyone: the creator.
  creators: Id[];
  mentionIds: Id[];
  authorName: string;
  place: string;
  noWorkersMessage: string;
}) {
  const { input, authorName, place, mentionIds } = options;
  const notifyAll = options.input.notifyAll ?? true;

  if (input.type === "update_request") {
    const asked = notifyAll
      ? [...options.workers, ...mentionIds]
      : [...mentionIds];
    if (getNotificationRecipients(asked, options.authorId).length === 0) {
      if (!notifyAll) {
        throw new AppError(
          400,
          "NO_RECIPIENTS",
          "Mention who you're asking, or send it to all assignees",
        );
      }
      if (options.workers.length === 0) {
        throw new AppError(400, "NO_ASSIGNEES", options.noWorkersMessage);
      }
      throw new AppError(
        400,
        "SELF_UPDATE_REQUEST",
        "You can't request an update from yourself. Assign another person.",
      );
    }
    return {
      notifyAll,
      askedIds: asked,
      notify: [
        {
          recipients: asked,
          message: `${authorName} asked you for an update ${place}`,
        },
      ] as NotifyGroup[],
    };
  }

  const kind = input.type === "question" ? "question" : "update";
  const notify: NotifyGroup[] = notifyAll
    ? [
        {
          recipients: mentionIds,
          message: `${authorName} mentioned you ${place}`,
        },
        {
          recipients: [...options.workers, ...options.creators],
          message:
            kind === "question"
              ? `${authorName} asked a question ${place}`
              : `${authorName} posted an update ${place}`,
          mutable: true,
        },
      ]
    : [
        {
          recipients: mentionIds,
          message:
            kind === "question"
              ? `${authorName} asked you a question ${place}`
              : `${authorName} shared an update with you ${place}`,
        },
      ];
  return { notifyAll, askedIds: [] as Id[], notify };
}

export async function createTaskActivity(
  taskId: string,
  input: CreateActivityInput,
) {
  if (input.type === "reply") return createReply({ taskId }, input);
  const context = getTenantContext()!;
  const task = await findTaskInLiveProject(taskId);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }
  await assertTaskVisible(task);
  assertCanPostLeadActivity(input.type);

  if (
    !isLead() &&
    !isTaskAssignee(task, context.userId) &&
    !(await TaskActivity.exists({
      taskId: task._id,
      mentionIds: new mongoose.Types.ObjectId(context.userId),
    }))
  ) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only assignees and people mentioned here can post on this task",
    );
  }

  // Admins and managers who aren't involved only hear when mentioned.
  const assignees = task.assigneeIds ?? [];
  const mentionIds = await getMentionRecipients(input, assignees, task);
  const plan = planNewMessage({
    input,
    authorId: context.userId,
    workers: assignees,
    creators: await creatorIfInvolved(task.createdBy, task),
    mentionIds,
    authorName: await getAuthorName(context.userId),
    place: `on "${task.title}"`,
    noWorkersMessage: "Assign someone to this task before requesting an update",
  });
  return recordActivity({
    projectId: task.projectId,
    taskId: task._id,
    input,
    mentionIds,
    ...plan,
  });
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
  return withAuthors(
    withoutOthersDirectedThreads(activities, getTenantContext()!.userId),
  );
}

export async function createProjectActivity(
  projectId: string,
  input: CreateActivityInput,
) {
  if (input.type === "reply") return createReply({ projectId }, input);
  const context = getTenantContext()!;
  const project = await Project.findById(projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }
  assertCanPostLeadActivity(input.type);

  if (!isLead()) {
    const userId = new mongoose.Types.ObjectId(context.userId);
    const canPostHere =
      (await Task.exists({ projectId, assigneeIds: userId })) ||
      (await TaskActivity.exists({
        projectId,
        taskId: null,
        mentionIds: userId,
      }));
    if (!canPostHere) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Only people assigned to a task in this project, or mentioned here, can post",
      );
    }
  }

  // The people working here are everyone with an open task. Admins and
  // managers who aren't involved only hear when mentioned.
  const openAssignees = await openTaskAssigneeIds(projectId);
  const mentionIds = await getMentionRecipients(input, openAssignees, null);
  const plan = planNewMessage({
    input,
    authorId: context.userId,
    workers: openAssignees,
    creators: await creatorIfInvolved(project.createdBy, null),
    mentionIds,
    authorName: await getAuthorName(context.userId),
    place: `in "${project.name}"`,
    noWorkersMessage:
      "No open task in this project has an assignee to ask for an update",
  });
  return recordActivity({
    projectId: project._id,
    taskId: null,
    input,
    mentionIds,
    ...plan,
  });
}

// One persisted thread and one notification per person for the Projects page
// action. The shared thread is visible in each qualifying project feed.
export async function createWorkspaceProjectActivity(
  input: CreateActivityInput,
) {
  if (input.type === "reply") {
    throw new AppError(
      400,
      "INVALID_ACTIVITY",
      "Replies need an existing thread",
    );
  }
  assertCanPostLeadActivity(input.type);
  const projects = await Project.find({ archivedAt: null, deletedAt: null })
    .select("_id name createdBy")
    .sort({ _id: 1 })
    .lean();
  const ids = projects.map((project) => project._id);
  const openTasks = ids.length
    ? await Task.find({
        projectId: { $in: ids },
        status: { $ne: "done" },
        archivedAt: null,
        deletedAt: null,
      })
        .select("projectId assigneeIds")
        .lean()
    : [];
  const participatingIds = new Set(
    openTasks.map((task) => String(task.projectId)),
  );
  const targets = projects.filter((project) =>
    participatingIds.has(String(project._id)),
  );
  if (!targets.length) {
    throw new AppError(400, "NO_PROJECTS", "No active project has open tasks");
  }
  const targetIdSet = new Set(targets.map((project) => String(project._id)));
  const workers = openTasks
    .filter((task) => targetIdSet.has(String(task.projectId)))
    .flatMap((task) => task.assigneeIds ?? []);
  const workerIds = [
    ...new Map(workers.map((id) => [String(id), id])).values(),
  ];
  const mentionIds = await getMentionRecipients(input, workerIds, null);
  const creatorIds: Id[] = [];
  for (const project of targets) {
    creatorIds.push(...(await creatorIfInvolved(project.createdBy, null)));
  }
  const uniqueCreators = [
    ...new Map(creatorIds.map((id) => [String(id), id])).values(),
  ];
  const projectNames = targets.map((project) => project.name);
  const context = getTenantContext()!;
  const plan = planNewMessage({
    input,
    authorId: context.userId,
    workers: workerIds,
    creators: uniqueCreators,
    mentionIds,
    authorName: await getAuthorName(context.userId),
    place: `across ${targets.length} active projects`,
    noWorkersMessage:
      "No open task in these projects has an assignee to ask for an update",
  });
  return recordActivity({
    projectId: targets[0]!._id,
    taskId: null,
    input,
    mentionIds,
    ...plan,
    projectIds: targets.map((project) => project._id),
    projectNames,
    sharedParticipantIds: [
      ...new Map(
        [
          ...plan.notify.flatMap((group) => group.recipients),
          ...plan.askedIds,
        ].map((id) => [String(id), id]),
      ).values(),
    ],
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

  const visible = {
    $and: [
      { $or: [{ projectId }, { projectIds: projectId }] },
      { $or: [{ taskId: null }, { taskId: { $in: [...taskTitles.keys()] } }] },
    ],
  };
  const latest = await TaskActivity.find(visible)
    .sort({ _id: -1 })
    .limit(PROJECT_FEED_LIMIT)
    .lean();
  const sharedRoots = latest
    .filter((activity) => activity.projectIds?.length)
    .map((activity) => activity._id);
  const sharedReplies = sharedRoots.length
    ? await TaskActivity.find({ parentId: { $in: sharedRoots } }).lean()
    : [];

  // A recent reply whose thread started before the cutoff brings its whole
  // thread along, so it's never shown without the message it answers.
  const loadedIds = new Set(latest.map((a) => String(a._id)));
  const missingRootIds = [
    ...new Set(
      latest
        .filter((a) => a.parentId && !loadedIds.has(String(a.parentId)))
        .map((a) => String(a.parentId)),
    ),
  ];
  const earlier =
    missingRootIds.length > 0
      ? await TaskActivity.find({
          ...visible,
          $and: [
            {
              $or: [
                { _id: { $in: missingRootIds } },
                { parentId: { $in: missingRootIds } },
              ],
            },
          ],
          _id: { $nin: [...loadedIds] },
        }).lean()
      : [];
  const activities = withoutOthersDirectedThreads(
    [...latest, ...earlier, ...sharedReplies],
    context.userId,
  ).sort((a, b) => String(a._id).localeCompare(String(b._id)));

  const withTask = activities.map((a) => ({
    ...a,
    task: a.taskId
      ? { _id: String(a.taskId), title: taskTitles.get(String(a.taskId))! }
      : null,
  }));
  return withAuthors(withTask);
}

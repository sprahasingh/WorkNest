import mongoose from "mongoose";
import { Meeting } from "../../models/Meeting.js";
import { Membership } from "../../models/Membership.js";
import { Notification } from "../../models/Notification.js";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { User } from "../../models/User.js";
import { AppError } from "../../lib/errors.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import { getTask, memberVisibilityFilter } from "../tasks/tasks.service.js";
import type {
  CreateMeetingInput,
  ListMeetingsQuery,
  ProposeInput,
  UpdateMeetingInput,
} from "./meetings.schemas.js";

const REMINDER_LEAD_MS = 15 * 60 * 1000;
const START_GRACE_MS = 5 * 60 * 1000;
const LIST_LIMIT = 200;

type Id = mongoose.Types.ObjectId;
type Scope = "this" | "all";
const oid = (value: string) => new mongoose.Types.ObjectId(value);
const myId = () => getTenantContext()!.userId;

type MeetingRecord = NonNullable<Awaited<ReturnType<typeof findVisible>>>;
export type MeetingNotificationKind =
  | "meeting_invited"
  | "meeting_updated"
  | "meeting_cancelled"
  | "meeting_response"
  | "meeting_starting"
  | "meeting_proposal";

async function loadPeople(ids: Iterable<string>) {
  const users = await User.find({ _id: { $in: [...new Set(ids)] } })
    .select("name email")
    .lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

async function requireOrgMembers(userIds: string[]): Promise<void> {
  const found = await Membership.countDocuments({ userId: { $in: userIds } });
  if (found !== new Set(userIds).size) {
    throw new AppError(
      400,
      "NOT_ORG_MEMBER",
      "You can only invite people in this organization",
    );
  }
}

// A meeting is visible to its organizer and invitees only, whatever their
// role in the organization.
async function findVisible(meetingId: string) {
  return Meeting.findOne({
    _id: meetingId,
    "attendees.userId": myId(),
  }).lean();
}

async function requireVisible(meetingId: string): Promise<MeetingRecord> {
  const meeting = await findVisible(meetingId);
  if (!meeting) throw new AppError(404, "NOT_FOUND", "Meeting not found");
  return meeting;
}

// A linked task or project is only named for people allowed to see it.
async function loadLinks(records: MeetingRecord[]) {
  const taskIds = [
    ...new Set(records.flatMap((m) => (m.taskId ? [String(m.taskId)] : []))),
  ];
  const projectIds = [
    ...new Set(
      records.flatMap((m) => (m.projectId ? [String(m.projectId)] : [])),
    ),
  ];
  const context = getTenantContext()!;
  const visibility =
    context.role === "member"
      ? await memberVisibilityFilter(context.userId)
      : {};
  const [tasks, projects] = await Promise.all([
    taskIds.length
      ? Task.find({ _id: { $in: taskIds }, ...visibility })
          .select("title projectId")
          .lean()
      : [],
    projectIds.length
      ? Project.find({ _id: { $in: projectIds } })
          .select("name")
          .lean()
      : [],
  ]);
  return {
    tasks: new Map(tasks.map((t) => [String(t._id), t])),
    projects: new Map(projects.map((p) => [String(p._id), p])),
  };
}

async function serialize(records: MeetingRecord[]) {
  const [people, links] = await Promise.all([
    loadPeople(
      records.flatMap((meeting) => [
        String(meeting.organizerId),
        ...meeting.attendees.map((attendee) => String(attendee.userId)),
        ...(meeting.proposals ?? []).map((p) => String(p.userId)),
      ]),
    ),
    loadLinks(records),
  ]);
  const me = myId();
  return records.map((meeting) => {
    const mine = meeting.attendees.find((a) => String(a.userId) === me);
    const isOrganizer = String(meeting.organizerId) === me;
    const task = meeting.taskId
      ? links.tasks.get(String(meeting.taskId))
      : null;
    const project = meeting.projectId
      ? links.projects.get(String(meeting.projectId))
      : null;
    return {
      id: String(meeting._id),
      title: meeting.title,
      agenda: meeting.agenda,
      notes: meeting.notes,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      joinUrl: meeting.joinUrl,
      location: meeting.location,
      cancelledAt: meeting.cancelledAt,
      series: meeting.seriesId
        ? {
            id: String(meeting.seriesId),
            index: meeting.seriesIndex,
            count: meeting.seriesCount,
            frequency: meeting.recurrence,
          }
        : null,
      link:
        meeting.taskId || meeting.projectId
          ? {
              projectId: meeting.projectId ? String(meeting.projectId) : null,
              projectName: project?.name ?? null,
              taskId: meeting.taskId ? String(meeting.taskId) : null,
              taskTitle: task?.title ?? null,
            }
          : null,
      organizer: {
        id: String(meeting.organizerId),
        name: people.get(String(meeting.organizerId))?.name ?? "Former member",
      },
      isOrganizer,
      myResponse: mine?.response ?? null,
      attendees: meeting.attendees.map((attendee) => ({
        userId: String(attendee.userId),
        name: people.get(String(attendee.userId))?.name ?? "Former member",
        email: people.get(String(attendee.userId))?.email ?? "",
        response: attendee.response,
        respondedAt: attendee.respondedAt,
      })),
      // The organizer sees everyone's suggestions; invitees only their own.
      proposals: (meeting.proposals ?? [])
        .filter((p) => isOrganizer || String(p.userId) === me)
        .map((p) => ({
          userId: String(p.userId),
          name: people.get(String(p.userId))?.name ?? "Former member",
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          note: p.note,
          createdAt: p.createdAt,
        })),
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    };
  });
}

async function serializeOne(meetingId: string | Id) {
  const meeting = await requireVisible(String(meetingId));
  return (await serialize([meeting]))[0];
}

export async function notifyMeeting(
  userIds: string[],
  type: MeetingNotificationKind,
  meetingId: Id,
  message: string,
  eventKey?: (userId: string) => string,
): Promise<void> {
  const recipients = [...new Set(userIds)].filter((id) => id !== myId());
  if (recipients.length === 0) return;
  const tenantId = oid(requireTenantId());
  const actorId = oid(myId());
  await Notification.bulkWrite(
    recipients.map((userId) => ({
      updateOne: {
        filter: eventKey
          ? { userId: oid(userId), eventKey: eventKey(userId) }
          : { _id: new mongoose.Types.ObjectId() },
        update: {
          $setOnInsert: {
            userId: oid(userId),
            tenantId,
            meetingId,
            type,
            actorId,
            message,
            eventKey: eventKey ? eventKey(userId) : null,
            readAt: null,
            dismissedAt: null,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

function assertNotPast(startsAt: Date): void {
  if (startsAt.getTime() < Date.now() - START_GRACE_MS) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Pick a start time that hasn't passed yet",
    );
  }
}

// What a meeting is linked to: a task (which also fixes its project) or just
// a project. Someone can only link what they're allowed to open.
async function resolveLink(
  taskId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<{ projectId: Id | null; taskId: Id | null }> {
  if (taskId) {
    const task = await getTask(taskId);
    return { projectId: task.projectId, taskId: task._id };
  }
  if (projectId) {
    const project = await Project.findById(projectId).select("_id").lean();
    if (!project) throw new AppError(404, "NOT_FOUND", "Project not found");
    return { projectId: project._id, taskId: null };
  }
  return { projectId: null, taskId: null };
}

// This meeting, or this one and every later one in its series.
async function occurrencesFrom(
  meeting: MeetingRecord,
  scope: Scope,
  extra: Record<string, unknown> = {},
): Promise<MeetingRecord[]> {
  if (scope !== "all" || !meeting.seriesId) return [meeting];
  return Meeting.find({
    seriesId: meeting.seriesId,
    startsAt: { $gte: meeting.startsAt },
    cancelledAt: null,
    "attendees.userId": myId(),
    ...extra,
  })
    .sort({ startsAt: 1 })
    .lean();
}

const FREQUENCY_LABEL = {
  daily: "every day",
  weekly: "every week",
  monthly: "every month",
} as const;

export async function listMeetings(query: ListMeetingsQuery) {
  const now = new Date();
  const visible = {
    "attendees.userId": myId(),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.taskId ? { taskId: query.taskId } : {}),
  };
  let filter: Record<string, unknown>;
  let sort: 1 | -1 = 1;

  if (query.view === "upcoming") {
    filter = { ...visible, endsAt: { $gte: now }, cancelledAt: null };
  } else if (query.view === "past") {
    filter = {
      ...visible,
      $or: [{ endsAt: { $lt: now } }, { cancelledAt: { $ne: null } }],
    };
    sort = -1;
  } else {
    filter = {
      ...visible,
      startsAt: { $lt: query.to },
      endsAt: { $gt: query.from },
    };
  }

  const meetings = await Meeting.find(filter)
    .sort({ startsAt: sort })
    .limit(LIST_LIMIT)
    .lean();
  return { meetings: await serialize(meetings) };
}

export async function getMeeting(meetingId: string) {
  return { meeting: await serializeOne(meetingId) };
}

export async function getMeetingSummary() {
  const now = new Date();
  const [pending, next] = await Promise.all([
    // A repeating meeting counts once, however many dates it has.
    Meeting.aggregate<{ n: number }>([
      {
        $match: {
          attendees: {
            $elemMatch: { userId: oid(myId()), response: "pending" },
          },
          endsAt: { $gte: now },
          cancelledAt: null,
        },
      },
      { $group: { _id: { $ifNull: ["$seriesId", "$_id"] } } },
      { $count: "n" },
    ]),
    Meeting.findOne({
      "attendees.userId": myId(),
      endsAt: { $gte: now },
      cancelledAt: null,
    })
      .sort({ startsAt: 1 })
      .select("title startsAt endsAt")
      .lean(),
  ]);
  return {
    pendingInvites: pending[0]?.n ?? 0,
    next: next
      ? {
          id: String(next._id),
          title: next.title,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
        }
      : null,
  };
}

export async function createMeeting(input: CreateMeetingInput) {
  const me = myId();
  assertNotPast(input.startsAt);
  const invitees = [...new Set(input.attendeeIds ?? [])].filter(
    (id) => id !== me,
  );
  if (invitees.length > 0) await requireOrgMembers(invitees);
  const link = await resolveLink(input.taskId, input.projectId);

  const attendees = [
    { userId: me, response: "accepted", respondedAt: new Date() },
    ...invitees.map((userId) => ({ userId })),
  ];
  const common = {
    organizerId: me,
    title: input.title,
    agenda: input.agenda ?? "",
    joinUrl: input.joinUrl || null,
    location: input.location ?? "",
    attendees,
    ...link,
  };

  let firstId: Id;
  const people = await loadPeople([me]);
  const who = people.get(me)?.name ?? "Someone";

  if (input.repeat) {
    const duration = input.endsAt.getTime() - input.startsAt.getTime();
    const seriesId = new mongoose.Types.ObjectId();
    const docs = input.repeat.starts.map((start, index) => ({
      ...common,
      startsAt: start,
      endsAt: new Date(start.getTime() + duration),
      seriesId,
      seriesIndex: index + 1,
      seriesCount: input.repeat!.starts.length,
      recurrence: input.repeat!.freq,
    }));
    const created = await Meeting.insertMany(docs);
    firstId = created[0]._id;
    await notifyMeeting(
      invitees,
      "meeting_invited",
      firstId,
      `${who} invited you to "${input.title}" (${FREQUENCY_LABEL[input.repeat.freq]})`,
    );
  } else {
    const meeting = await Meeting.create({
      ...common,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    firstId = meeting._id;
    await notifyMeeting(
      invitees,
      "meeting_invited",
      firstId,
      `${who} invited you to "${input.title}"`,
    );
  }
  return { meeting: await serializeOne(firstId) };
}

export async function updateMeeting(
  meetingId: string,
  input: UpdateMeetingInput,
) {
  const me = myId();
  const meeting = await requireVisible(meetingId);
  if (String(meeting.organizerId) !== me) {
    throw new AppError(403, "FORBIDDEN", "Only the organizer can change this");
  }
  if (meeting.cancelledAt) {
    throw new AppError(409, "MEETING_CANCELLED", "This meeting was cancelled");
  }

  const scope: Scope = input.scope ?? "this";
  const startsAt = input.startsAt ?? meeting.startsAt;
  const endsAt = input.endsAt ?? meeting.endsAt;
  if (endsAt <= startsAt) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "The end time must be after the start time",
    );
  }
  const startChanged = startsAt.getTime() !== meeting.startsAt.getTime();
  const timeChanged =
    startChanged || endsAt.getTime() !== meeting.endsAt.getTime();
  // Only a new start has to be in the future, so a running meeting can still
  // be extended.
  if (startChanged) assertNotPast(startsAt);
  const shift = startsAt.getTime() - meeting.startsAt.getTime();
  const duration = endsAt.getTime() - startsAt.getTime();

  const current = meeting.attendees.map((a) => String(a.userId));
  let added: string[] = [];
  let removed: string[] = [];
  if (input.attendeeIds) {
    const wanted = new Set([...input.attendeeIds, me]);
    added = [...wanted].filter((id) => !current.includes(id));
    removed = current.filter((id) => !wanted.has(id));
    if (added.length > 0) await requireOrgMembers(added);
  }

  const linkChanged =
    input.taskId !== undefined || input.projectId !== undefined;
  const link = linkChanged
    ? await resolveLink(input.taskId, input.projectId)
    : null;

  const targets = await occurrencesFrom(meeting, scope, { organizerId: me });
  for (const target of targets) {
    const isEdited = String(target._id) === String(meeting._id);
    let attendees = target.attendees
      .filter((a) => !removed.includes(String(a.userId)))
      .map((a) => ({
        userId: a.userId,
        response: a.response,
        respondedAt: a.respondedAt,
      }));
    for (const id of added) {
      if (!attendees.some((a) => String(a.userId) === id)) {
        attendees.push({
          userId: oid(id),
          response: "pending",
          respondedAt: null,
        });
      }
    }
    const targetStart = isEdited
      ? startsAt
      : new Date(target.startsAt.getTime() + shift);
    // A new time means everyone has to answer again.
    if (timeChanged) {
      attendees = attendees.map((a) =>
        String(a.userId) === me
          ? a
          : { ...a, response: "pending", respondedAt: null },
      );
    }
    await Meeting.updateOne(
      { _id: target._id },
      {
        $set: {
          title: input.title ?? target.title,
          agenda: input.agenda ?? target.agenda,
          joinUrl:
            input.joinUrl === undefined
              ? target.joinUrl
              : input.joinUrl || null,
          location: input.location ?? target.location,
          attendees,
          ...(timeChanged
            ? {
                startsAt: targetStart,
                endsAt: new Date(targetStart.getTime() + duration),
              }
            : {}),
          // Minutes belong to one date, so they never spread to the series.
          ...(isEdited && input.notes !== undefined
            ? { notes: input.notes }
            : {}),
          ...(link ? { projectId: link.projectId, taskId: link.taskId } : {}),
          ...(isEdited && timeChanged ? { proposals: [] } : {}),
        },
      },
    );
  }

  const nextTitle = input.title ?? meeting.title;
  const people = await loadPeople([me]);
  const who = people.get(me)?.name ?? "Someone";
  const suffix = scope === "all" && meeting.seriesId ? " (all upcoming)" : "";
  await notifyMeeting(
    added,
    "meeting_invited",
    meeting._id,
    `${who} invited you to "${nextTitle}"`,
  );
  await notifyMeeting(
    removed,
    "meeting_updated",
    meeting._id,
    `${who} removed you from "${nextTitle}"`,
  );
  const stay = current.filter((id) => !removed.includes(id));
  const detailsChanged =
    timeChanged ||
    (input.title !== undefined && input.title !== meeting.title) ||
    (input.joinUrl !== undefined &&
      (input.joinUrl || null) !== meeting.joinUrl) ||
    (input.location !== undefined && input.location !== meeting.location);
  if (detailsChanged) {
    await notifyMeeting(
      stay,
      "meeting_updated",
      meeting._id,
      timeChanged
        ? `${who} changed the time of "${nextTitle}"${suffix}`
        : `${who} updated "${nextTitle}"${suffix}`,
    );
  }
  return { meeting: await serializeOne(meeting._id) };
}

export async function cancelMeeting(meetingId: string, scope: Scope = "this") {
  const meeting = await requireVisible(meetingId);
  if (String(meeting.organizerId) !== myId()) {
    throw new AppError(403, "FORBIDDEN", "Only the organizer can cancel this");
  }
  if (!meeting.cancelledAt) {
    const targets = await occurrencesFrom(meeting, scope, {
      organizerId: myId(),
    });
    await Meeting.updateMany(
      { _id: { $in: targets.map((t) => t._id) } },
      { cancelledAt: new Date() },
    );
    const people = await loadPeople([myId()]);
    await notifyMeeting(
      meeting.attendees.map((a) => String(a.userId)),
      "meeting_cancelled",
      meeting._id,
      `${people.get(myId())?.name ?? "Someone"} cancelled "${meeting.title}"${
        targets.length > 1 ? " (all upcoming)" : ""
      }`,
    );
  }
  return { meeting: await serializeOne(meeting._id) };
}

export async function respondToMeeting(
  meetingId: string,
  response: "accepted" | "tentative" | "declined",
  scope: Scope = "this",
) {
  const me = myId();
  const meeting = await requireVisible(meetingId);
  if (meeting.cancelledAt) {
    throw new AppError(409, "MEETING_CANCELLED", "This meeting was cancelled");
  }
  if (String(meeting.organizerId) === me) {
    throw new AppError(400, "VALIDATION_ERROR", "You're the organizer");
  }
  const previous = meeting.attendees.find((a) => String(a.userId) === me);
  const targets = await occurrencesFrom(meeting, scope, {
    endsAt: { $gte: new Date() },
  });
  await Meeting.updateMany(
    { _id: { $in: targets.map((t) => t._id) }, "attendees.userId": me },
    {
      $set: {
        "attendees.$.response": response,
        "attendees.$.respondedAt": new Date(),
      },
    },
  );
  if (previous?.response !== response) {
    const people = await loadPeople([me]);
    const verb = {
      accepted: "accepted",
      tentative: "replied maybe to",
      declined: "declined",
    }[response];
    await notifyMeeting(
      [String(meeting.organizerId)],
      "meeting_response",
      meeting._id,
      `${people.get(me)?.name ?? "Someone"} ${verb} "${meeting.title}"${
        targets.length > 1 ? " (all upcoming)" : ""
      }`,
    );
  }
  return { meeting: await serializeOne(meeting._id) };
}

// ---- Proposing another time ---------------------------------------------

export async function proposeTime(meetingId: string, input: ProposeInput) {
  const me = myId();
  const meeting = await requireVisible(meetingId);
  if (meeting.cancelledAt || meeting.endsAt < new Date()) {
    throw new AppError(409, "MEETING_CLOSED", "This meeting is over");
  }
  if (String(meeting.organizerId) === me) {
    throw new AppError(400, "VALIDATION_ERROR", "You're the organizer");
  }
  assertNotPast(input.startsAt);
  if (
    input.startsAt.getTime() === meeting.startsAt.getTime() &&
    input.endsAt.getTime() === meeting.endsAt.getTime()
  ) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "That's already the time of the meeting",
    );
  }

  await Meeting.updateOne(
    { _id: meeting._id },
    { $pull: { proposals: { userId: oid(me) } } },
  );
  await Meeting.updateOne(
    { _id: meeting._id },
    {
      $push: {
        proposals: {
          userId: oid(me),
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          note: input.note ?? "",
          createdAt: new Date(),
        },
      },
    },
  );
  const people = await loadPeople([me]);
  await notifyMeeting(
    [String(meeting.organizerId)],
    "meeting_proposal",
    meeting._id,
    `${people.get(me)?.name ?? "Someone"} suggested a new time for "${meeting.title}"`,
  );
  return { meeting: await serializeOne(meeting._id) };
}

export async function acceptProposal(meetingId: string, proposerId: string) {
  const meeting = await requireVisible(meetingId);
  if (String(meeting.organizerId) !== myId()) {
    throw new AppError(403, "FORBIDDEN", "Only the organizer can do that");
  }
  const proposal = (meeting.proposals ?? []).find(
    (p) => String(p.userId) === proposerId,
  );
  if (!proposal) throw new AppError(404, "NOT_FOUND", "Suggestion not found");
  // Moving the meeting clears every suggestion and asks everyone to reply.
  const moved = await updateMeeting(meetingId, {
    startsAt: proposal.startsAt,
    endsAt: proposal.endsAt,
  });
  // Whatever happened to the time, this suggestion has been dealt with.
  await Meeting.updateOne(
    { _id: meeting._id },
    { $pull: { proposals: { userId: oid(proposerId) } } },
  );
  return { meeting: { ...moved.meeting, proposals: [] } };
}

export async function dismissProposal(meetingId: string, proposerId: string) {
  const me = myId();
  const meeting = await requireVisible(meetingId);
  const isOrganizer = String(meeting.organizerId) === me;
  if (!isOrganizer && proposerId !== me) {
    throw new AppError(403, "FORBIDDEN", "That isn't your suggestion");
  }
  await Meeting.updateOne(
    { _id: meeting._id },
    { $pull: { proposals: { userId: oid(proposerId) } } },
  );
  if (isOrganizer && proposerId !== me) {
    const people = await loadPeople([me]);
    await notifyMeeting(
      [proposerId],
      "meeting_response",
      meeting._id,
      `${people.get(me)?.name ?? "Someone"} kept the original time for "${meeting.title}"`,
    );
  }
  return { meeting: await serializeOne(meeting._id) };
}

let reminderSweepRunning = false;

// Runs every minute from the server: anyone going to a meeting that starts in
// the next 15 minutes gets one reminder.
export async function sendMeetingReminders(): Promise<void> {
  if (reminderSweepRunning) return;
  reminderSweepRunning = true;
  try {
    const now = new Date();
    // Raw collection access: this sweep spans every organization on purpose.
    const meetings = await Meeting.collection
      .find<{
        _id: Id;
        tenantId: Id;
        title: string;
        startsAt: Date;
        attendees: { userId: Id; response: string }[];
      }>({
        startsAt: {
          $gt: now,
          $lte: new Date(now.getTime() + REMINDER_LEAD_MS),
        },
        cancelledAt: null,
      })
      .toArray();

    for (const meeting of meetings) {
      const operations = meeting.attendees
        .filter((attendee) => attendee.response !== "declined")
        .map((attendee) => {
          const eventKey = `meeting-starting:${meeting._id}:${meeting.startsAt.getTime()}`;
          return {
            updateOne: {
              filter: { userId: attendee.userId, eventKey },
              update: {
                $setOnInsert: {
                  userId: attendee.userId,
                  tenantId: meeting.tenantId,
                  meetingId: meeting._id,
                  type: "meeting_starting" as const,
                  actorId: null,
                  message: `"${meeting.title}" is starting soon`,
                  eventKey,
                  readAt: null,
                  dismissedAt: null,
                },
              },
              upsert: true,
            },
          };
        });
      if (operations.length > 0) {
        await Notification.bulkWrite(operations, { ordered: false });
      }
    }
  } finally {
    reminderSweepRunning = false;
  }
}

import { destroyConversationFiles } from "../chat/chatFiles.cleanup.js";
import mongoose from "mongoose";
import { Conversation } from "../../models/Conversation.js";
import { Meeting } from "../../models/Meeting.js";
import { Membership } from "../../models/Membership.js";
import { Message } from "../../models/Message.js";
import { User } from "../../models/User.js";
import { AppError } from "../../lib/errors.js";
import { emitToUsers } from "../../realtime/hub.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import { notifyMeeting } from "../meetings/meetings.service.js";

export type MeetingChoice =
  { action: "cancel" } | { action: "handover"; userId: string };

const oid = (value: string) => new mongoose.Types.ObjectId(value);

function upcomingOrganizedBy(userId: string) {
  return {
    organizerId: oid(userId),
    endsAt: { $gte: new Date() },
    cancelledAt: null,
  };
}

// What leaving would do to someone's meetings, so the dialog can ask what to
// do with them. Titles are only shown to the person themselves; an admin gets
// a count, since other people's meetings are private.
export async function describeMeetingImpact(
  userId: string,
  includeTitles: boolean,
) {
  const meetings = await Meeting.find(upcomingOrganizedBy(userId))
    .sort({ startsAt: 1 })
    .select("title startsAt seriesId")
    .lean();
  const distinct = new Set(meetings.map((m) => String(m.seriesId ?? m._id)))
    .size;
  return {
    organizedUpcoming: meetings.length,
    organizedUpcomingSeries: distinct,
    ...(includeTitles
      ? {
          meetings: meetings.slice(0, 20).map((m) => ({
            id: String(m._id),
            title: m.title,
            startsAt: m.startsAt,
          })),
        }
      : {}),
  };
}

export async function validateMeetingChoice(
  departingUserId: string,
  choice: MeetingChoice | undefined,
): Promise<void> {
  if (choice?.action !== "handover") return;
  if (choice.userId === departingUserId) {
    throw new AppError(400, "VALIDATION_ERROR", "Choose someone else");
  }
  const target = await Membership.exists({ userId: choice.userId });
  if (!target) {
    throw new AppError(
      400,
      "NOT_ORG_MEMBER",
      "Meetings can only be handed to someone in this organization",
    );
  }
}

// Runs after the membership is gone. A person who leaves is taken out of the
// groups they were in, and their meetings are either handed to someone or
// cancelled, so nothing is left with no owner. One-to-one chats stay where
// they are: the other person keeps the history but can't send to someone
// who's no longer here.
export async function cleanupAfterDeparture(
  userId: string,
  choice: MeetingChoice = { action: "cancel" },
): Promise<void> {
  const actorId = getTenantContext()!.userId;
  const tenantId = requireTenantId();
  const person = await User.findById(userId).select("name").lean();
  const name = person?.name ?? "Someone";

  // --- Groups
  const groups = await Conversation.find({
    type: "group",
    "members.userId": userId,
  }).lean();
  for (const group of groups) {
    const remaining = group.members
      .map((m) => String(m.userId))
      .filter((id) => id !== userId);
    if (remaining.length === 0) {
      await destroyConversationFiles(group._id);
      await Message.deleteMany({ conversationId: group._id });
      await Conversation.deleteOne({ _id: group._id });
      continue;
    }
    let adminIds = group.adminIds.map(String).filter((id) => id !== userId);
    if (adminIds.length === 0) adminIds = [remaining[0]];
    await Conversation.updateOne(
      { _id: group._id },
      {
        $pull: { members: { userId: oid(userId) } },
        $set: { adminIds: adminIds.map(oid) },
      },
    );
    const text = `${name} left the organization`;
    await Message.create({
      conversationId: group._id,
      kind: "system",
      senderId: actorId,
      text,
    });
    await Conversation.updateOne(
      { _id: group._id },
      {
        lastMessageAt: new Date(),
        lastMessage: {
          senderId: actorId,
          text,
          hasAttachment: false,
          deleted: false,
          system: true,
        },
      },
    );
    emitToUsers(remaining, "chat:event", {
      orgId: tenantId,
      kind: "conversation",
      conversationId: String(group._id),
    });
  }

  // --- Meetings they were only invited to
  await Meeting.updateMany(
    {
      endsAt: { $gte: new Date() },
      cancelledAt: null,
      organizerId: { $ne: oid(userId) },
      "attendees.userId": userId,
    },
    {
      $pull: {
        attendees: { userId: oid(userId) },
        proposals: { userId: oid(userId) },
      },
    },
  );

  // --- Meetings they organize
  const organized = await Meeting.find(upcomingOrganizedBy(userId)).lean();
  if (organized.length === 0) return;
  const first = organized[0];
  const audience = (m: (typeof organized)[number]) =>
    m.attendees.map((a) => String(a.userId)).filter((id) => id !== userId);

  if (choice.action === "handover") {
    const newOrganizer = oid(choice.userId);
    for (const meeting of organized) {
      const attendees = meeting.attendees
        .filter((a) => String(a.userId) !== userId)
        .map((a) => ({
          userId: a.userId,
          response: a.response,
          respondedAt: a.respondedAt,
        }));
      if (!attendees.some((a) => String(a.userId) === choice.userId)) {
        attendees.push({
          userId: newOrganizer,
          response: "accepted",
          respondedAt: new Date(),
        });
      }
      await Meeting.updateOne(
        { _id: meeting._id },
        {
          $set: {
            organizerId: newOrganizer,
            attendees,
            proposals: [],
          },
        },
      );
    }
    await notifyMeeting(
      [choice.userId],
      "meeting_invited",
      first._id,
      `${name} handed you ${
        organized.length === 1
          ? `the meeting "${first.title}"`
          : `${organized.length} meetings`
      } to organize`,
    );
    return;
  }

  await Meeting.updateMany(
    { _id: { $in: organized.map((m) => m._id) } },
    { cancelledAt: new Date() },
  );
  const told = new Set<string>();
  for (const meeting of organized) {
    const key = String(meeting.seriesId ?? meeting._id);
    if (told.has(key)) continue;
    told.add(key);
    await notifyMeeting(
      audience(meeting),
      "meeting_cancelled",
      meeting._id,
      `"${meeting.title}" was cancelled because ${name} left the organization`,
    );
  }
}

import mongoose from "mongoose";
import { Conversation } from "../../models/Conversation.js";
import { Message } from "../../models/Message.js";
import { Membership } from "../../models/Membership.js";
import { User } from "../../models/User.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import {
  createUploadSignature,
  destroyUpload,
  fetchUploadedSize,
  isCloudinaryConfigured,
  isCloudinaryUrl,
} from "../../lib/cloudinary.js";
import { signFileToken } from "../../lib/fileToken.js";
import { emitToUsers, isUserOnline } from "../../realtime/hub.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import {
  MAX_FILE_BYTES,
  MAX_GROUP_MEMBERS,
  type CreateConversationInput,
  type ListMessagesQuery,
  type SendMessageInput,
} from "./chat.schemas.js";

export const EDIT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_PAGE = 30;

type Id = mongoose.Types.ObjectId;
const oid = (value: string) => new mongoose.Types.ObjectId(value);
const myId = () => getTenantContext()!.userId;

interface Person {
  id: string;
  name: string;
  email: string;
}

async function loadPeople(ids: Iterable<string>): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  const users = await User.find({ _id: { $in: unique } })
    .select("name email")
    .lean();
  return new Map(
    users.map((user) => [
      String(user._id),
      { id: String(user._id), name: user.name, email: user.email },
    ]),
  );
}

// Anyone you can message must still belong to this organization.
async function requireOrgMembers(userIds: string[]): Promise<void> {
  const found = await Membership.countDocuments({ userId: { $in: userIds } });
  if (found !== new Set(userIds).size) {
    throw new AppError(
      400,
      "NOT_ORG_MEMBER",
      "You can only message people in this organization",
    );
  }
}

async function orgMemberIdSet(userIds: string[]): Promise<Set<string>> {
  const memberships = await Membership.find({ userId: { $in: userIds } })
    .select("userId")
    .lean();
  return new Set(memberships.map((m) => String(m.userId)));
}

type ConversationRecord = Awaited<ReturnType<typeof findMine>>;

// Only people in the conversation can open it, whatever their role. Anyone
// else gets a plain "not found", so its existence isn't revealed.
async function findMine(conversationId: string) {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    "members.userId": myId(),
  }).lean();
  if (!conversation) {
    throw new AppError(404, "NOT_FOUND", "Conversation not found");
  }
  return conversation;
}

// The moment before which this person has cleared the chat, if they did.
function myClearedAt(
  conversation: NonNullable<ConversationRecord>,
): Date | null {
  return (
    conversation.members.find((member) => String(member.userId) === myId())
      ?.clearedAt ?? null
  );
}

function memberIds(conversation: NonNullable<ConversationRecord>): string[] {
  return conversation.members.map((member) => String(member.userId));
}

function previewOf(message: {
  text?: string | null;
  attachments?: unknown[];
}): string {
  const text = (message.text ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 120);
  return message.attachments?.length ? "Sent an attachment" : "";
}

interface UnreadCounts {
  unread: number;
  mentions: number;
}

function serializeConversation(
  conversation: NonNullable<ConversationRecord>,
  people: Map<string, Person>,
  counts: UnreadCounts,
) {
  const mine = conversation.members.find(
    (member) => String(member.userId) === myId(),
  );
  return {
    id: String(conversation._id),
    type: conversation.type,
    name: conversation.name,
    createdBy: String(conversation.createdBy),
    adminIds: conversation.adminIds.map(String),
    members: conversation.members.map((member) => ({
      userId: String(member.userId),
      name: people.get(String(member.userId))?.name ?? "Former member",
      email: people.get(String(member.userId))?.email ?? "",
      lastReadAt: member.lastReadAt,
    })),
    lastMessage: conversation.lastMessage
      ? {
          senderId: String(conversation.lastMessage.senderId),
          text: conversation.lastMessage.deleted
            ? ""
            : conversation.lastMessage.text,
          hasAttachment: conversation.lastMessage.hasAttachment,
          deleted: conversation.lastMessage.deleted,
          system: conversation.lastMessage.system,
        }
      : null,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    unreadCount: counts.unread,
    mentionCount: counts.mentions,
    muted: Boolean(mine?.mutedAt),
  };
}

async function countUnreadFor(
  conversations: NonNullable<ConversationRecord>[],
): Promise<Map<string, UnreadCounts>> {
  const clauses = conversations.flatMap((conversation) => {
    const mine = conversation.members.find(
      (member) => String(member.userId) === myId(),
    );
    return mine
      ? [
          {
            conversationId: conversation._id,
            createdAt: { $gt: mine.lastReadAt },
          },
        ]
      : [];
  });
  if (clauses.length === 0) return new Map();
  const rows = await Message.aggregate<{
    _id: Id;
    count: number;
    mentions: number;
  }>([
    {
      $match: {
        senderId: { $ne: oid(myId()) },
        kind: "user",
        deletedAt: null,
        $or: clauses,
      },
    },
    {
      $group: {
        _id: "$conversationId",
        count: { $sum: 1 },
        mentions: {
          $sum: {
            $cond: [
              { $in: [oid(myId()), { $ifNull: ["$mentions", []] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      String(row._id),
      { unread: row.count, mentions: row.mentions },
    ]),
  );
}

export async function listConversations() {
  const conversations = await Conversation.find({ "members.userId": myId() })
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .lean()
    .then((found) =>
      // A chat you deleted for yourself stays hidden until something new
      // arrives in it.
      found.filter((conversation) => {
        const cleared = myClearedAt(conversation);
        return !cleared || conversation.lastMessageAt > cleared;
      }),
    );
  const [people, unread] = await Promise.all([
    loadPeople(conversations.flatMap(memberIds)),
    countUnreadFor(conversations),
  ]);
  const items = conversations.map((conversation) =>
    serializeConversation(
      conversation,
      people,
      unread.get(String(conversation._id)) ?? { unread: 0, mentions: 0 },
    ),
  );
  // A muted chat only counts when someone mentions you in it.
  return {
    conversations: items,
    unreadCount: items.reduce(
      (total, item) =>
        total + (item.muted ? item.mentionCount : item.unreadCount),
      0,
    ),
  };
}

async function serializeOne(conversationId: string) {
  const conversation = await findMine(conversationId);
  const [people, unread] = await Promise.all([
    loadPeople(memberIds(conversation)),
    countUnreadFor([conversation]),
  ]);
  return serializeConversation(
    conversation,
    people,
    unread.get(String(conversation._id)) ?? { unread: 0, mentions: 0 },
  );
}

export async function getConversation(conversationId: string) {
  return { conversation: await serializeOne(conversationId) };
}

function notifyConversation(
  userIds: Iterable<string>,
  payload: Record<string, unknown>,
): void {
  emitToUsers(userIds, "chat:event", {
    orgId: requireTenantId(),
    ...payload,
  });
}

async function addSystemMessage(
  conversationId: Id,
  text: string,
  recipients: string[],
): Promise<void> {
  await Message.create({
    conversationId,
    kind: "system",
    senderId: myId(),
    text,
  });
  await Conversation.updateOne(
    { _id: conversationId },
    {
      lastMessageAt: new Date(),
      lastMessage: {
        senderId: myId(),
        text,
        hasAttachment: false,
        deleted: false,
        system: true,
      },
    },
  );
  notifyConversation(recipients, {
    kind: "message",
    conversationId: String(conversationId),
    messageId: null,
    senderId: myId(),
    silent: true,
  });
}

export async function createConversation(input: CreateConversationInput) {
  const me = myId();

  if (input.type === "direct") {
    if (input.userId === me) {
      throw new AppError(400, "VALIDATION_ERROR", "Choose someone else");
    }
    await requireOrgMembers([input.userId]);
    const directKey = [me, input.userId].sort().join(":");
    let conversation = await Conversation.findOne({ directKey }).lean();
    let created = false;
    if (!conversation) {
      try {
        const doc = await Conversation.create({
          type: "direct",
          createdBy: me,
          directKey,
          members: [{ userId: me }, { userId: input.userId }],
        });
        conversation = doc.toObject();
        created = true;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        conversation = await Conversation.findOne({ directKey }).lean();
      }
    }
    const result = await serializeOne(String(conversation!._id));
    if (created) {
      notifyConversation([me, input.userId], {
        kind: "conversation",
        conversationId: result.id,
      });
    }
    return { conversation: result, created };
  }

  const others = [...new Set(input.memberIds)].filter((id) => id !== me);
  if (others.length === 0) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Add at least one other person",
    );
  }
  await requireOrgMembers(others);
  const doc = await Conversation.create({
    type: "group",
    name: input.name,
    createdBy: me,
    adminIds: [me],
    members: [me, ...others].map((userId) => ({ userId })),
  });
  const people = await loadPeople([me]);
  await addSystemMessage(
    doc._id,
    `${people.get(me)?.name ?? "Someone"} created the group`,
    [me, ...others],
  );
  const result = await serializeOne(String(doc._id));
  notifyConversation([me, ...others], {
    kind: "conversation",
    conversationId: result.id,
  });
  return { conversation: result, created: true };
}

function requireGroupAdmin(conversation: NonNullable<ConversationRecord>) {
  if (conversation.type !== "group") {
    throw new AppError(400, "NOT_A_GROUP", "This is not a group chat");
  }
  if (!conversation.adminIds.map(String).includes(myId())) {
    throw new AppError(403, "FORBIDDEN", "Only group admins can do that");
  }
}

export async function renameConversation(conversationId: string, name: string) {
  const conversation = await findMine(conversationId);
  requireGroupAdmin(conversation);
  await Conversation.updateOne({ _id: conversation._id }, { name });
  notifyConversation(memberIds(conversation), {
    kind: "conversation",
    conversationId,
  });
  return { conversation: await serializeOne(conversationId) };
}

export async function addConversationMembers(
  conversationId: string,
  userIds: string[],
) {
  const conversation = await findMine(conversationId);
  requireGroupAdmin(conversation);
  const existing = new Set(memberIds(conversation));
  const fresh = [...new Set(userIds)].filter((id) => !existing.has(id));
  if (fresh.length === 0)
    return { conversation: await serializeOne(conversationId) };
  if (existing.size + fresh.length > MAX_GROUP_MEMBERS) {
    throw new AppError(
      400,
      "GROUP_FULL",
      `Groups can have up to ${MAX_GROUP_MEMBERS} people`,
    );
  }
  await requireOrgMembers(fresh);
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $push: {
        members: {
          $each: fresh.map((userId) => ({
            userId,
            // New people only see what's sent from now on as unread.
            lastReadAt: new Date(),
          })),
        },
      },
    },
  );
  const people = await loadPeople([myId(), ...fresh]);
  const names = fresh.map((id) => people.get(id)?.name ?? "Someone").join(", ");
  await addSystemMessage(
    conversation._id,
    `${people.get(myId())?.name ?? "Someone"} added ${names}`,
    [...existing, ...fresh],
  );
  notifyConversation([...existing, ...fresh], {
    kind: "conversation",
    conversationId,
  });
  return { conversation: await serializeOne(conversationId) };
}

export async function removeConversationMember(
  conversationId: string,
  userId: string,
) {
  const conversation = await findMine(conversationId);
  if (conversation.type !== "group") {
    throw new AppError(400, "NOT_A_GROUP", "This is not a group chat");
  }
  const leaving = userId === myId();
  if (!leaving) requireGroupAdmin(conversation);
  const everyone = memberIds(conversation);
  if (!everyone.includes(userId)) {
    throw new AppError(404, "NOT_FOUND", "That person is not in this group");
  }

  const remaining = everyone.filter((id) => id !== userId);
  if (remaining.length === 0) {
    await Message.deleteMany({ conversationId: conversation._id });
    await Conversation.deleteOne({ _id: conversation._id });
    notifyConversation(everyone, { kind: "conversation", conversationId });
    return { left: true, deleted: true };
  }

  let adminIds = conversation.adminIds
    .map(String)
    .filter((id) => id !== userId);
  // A group is never left without an admin.
  if (adminIds.length === 0) adminIds = [remaining[0]];
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $pull: { members: { userId: oid(userId) } },
      $set: { adminIds: adminIds.map(oid) },
    },
  );
  const people = await loadPeople([myId(), userId]);
  const text = leaving
    ? `${people.get(myId())?.name ?? "Someone"} left`
    : `${people.get(myId())?.name ?? "Someone"} removed ${people.get(userId)?.name ?? "someone"}`;
  await addSystemMessage(conversation._id, text, remaining);
  notifyConversation(everyone, { kind: "conversation", conversationId });
  return { left: leaving, deleted: false };
}

// ---- Messages ----------------------------------------------------------

type MessageRecord = Awaited<ReturnType<typeof loadMessages>>[number];

async function loadMessages(filter: Record<string, unknown>, limit: number) {
  return Message.find(filter).sort({ _id: -1 }).limit(limit).lean();
}

async function serializeMessages(messages: MessageRecord[]) {
  const replyIds = [
    ...new Set(
      messages
        .map((m) => (m.replyToId ? String(m.replyToId) : null))
        .filter((id): id is string => id !== null),
    ),
  ];
  const replies = replyIds.length
    ? await Message.find({ _id: { $in: replyIds } })
        .select("senderId text deletedAt attachments")
        .lean()
    : [];
  const replyMap = new Map(replies.map((r) => [String(r._id), r]));
  const me = myId();
  return messages.map((message) => {
    const deleted = message.deletedAt !== null;
    const reply = message.replyToId
      ? replyMap.get(String(message.replyToId))
      : undefined;
    return {
      id: String(message._id),
      conversationId: String(message.conversationId),
      kind: message.kind,
      senderId: String(message.senderId),
      text: deleted ? "" : message.text,
      replyTo: message.replyToId
        ? {
            id: String(message.replyToId),
            senderId: reply ? String(reply.senderId) : null,
            text: !reply || reply.deletedAt ? "" : previewOf(reply),
            deleted: !reply || reply.deletedAt !== null,
          }
        : null,
      mentions: deleted ? [] : (message.mentions ?? []).map(String),
      attachments: deleted
        ? []
        : message.attachments.map((attachment, index) => ({
            // Files have no public link: this one is checked against the
            // conversation when it's opened, and stops working after a while.
            url: `/api/chat-files/${signFileToken({
              userId: me,
              orgId: requireTenantId(),
              messageId: String(message._id),
              index,
            })}`,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            isImage: attachment.resourceType === "image",
          })),
      reactions: deleted
        ? []
        : message.reactions.map((reaction) => ({
            emoji: reaction.emoji,
            userIds: reaction.userIds.map(String),
          })),
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
    };
  });
}

export async function listMessages(
  conversationId: string,
  query: ListMessagesQuery,
) {
  const conversation = await findMine(conversationId);
  const limit = query.limit ?? DEFAULT_PAGE;
  const found = await loadMessages(
    {
      conversationId: conversation._id,
      ...(query.before ? { _id: { $lt: oid(query.before) } } : {}),
      ...(myClearedAt(conversation)
        ? { createdAt: { $gt: myClearedAt(conversation) } }
        : {}),
    },
    limit + 1,
  );
  const hasMore = found.length > limit;
  const page = found.slice(0, limit).reverse();
  return {
    messages: await serializeMessages(page),
    hasMore,
    nextCursor: hasMore ? String(page[0]._id) : null,
  };
}

async function serializeOneMessage(messageId: Id) {
  const [message] = await loadMessages({ _id: messageId }, 1);
  return (await serializeMessages([message]))[0];
}

export async function sendMessage(
  conversationId: string,
  input: SendMessageInput,
) {
  const me = myId();
  const conversation = await findMine(conversationId);
  const everyone = memberIds(conversation);

  // People who've left the organization stop receiving anything.
  const inOrg = await orgMemberIdSet(everyone);
  if (conversation.type === "direct") {
    const other = everyone.find((id) => id !== me);
    if (!other || !inOrg.has(other)) {
      throw new AppError(
        409,
        "RECIPIENT_UNAVAILABLE",
        "This person is no longer in the organization",
      );
    }
  }

  if (input.replyToId) {
    const target = await Message.findOne({
      _id: input.replyToId,
      conversationId: conversation._id,
    })
      .select("_id")
      .lean();
    if (!target) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "The message you replied to is gone",
      );
    }
  }

  const attachments = input.attachments ?? [];
  if (attachments.length > 0) {
    if (!isCloudinaryConfigured()) {
      throw new AppError(503, "ATTACHMENTS_DISABLED", "Attachments are off");
    }
    const tenantId = requireTenantId();
    for (const attachment of attachments) {
      if (
        !isCloudinaryUrl(attachment.url) ||
        !attachment.publicId.startsWith(`worknest/${tenantId}/chat/`) ||
        // The link has to be the file that public id points to, so nobody
        // can attach another organization's upload.
        !attachment.url.includes(`/${attachment.publicId}`)
      ) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid attachment");
      }
    }
  }

  // The size limit in the browser can be skipped, so check the real files.
  for (const attachment of attachments) {
    const bytes = await fetchUploadedSize(
      attachment.publicId,
      attachment.resourceType,
    );
    if (bytes !== null && bytes > MAX_FILE_BYTES) {
      await Promise.all(
        attachments.map((item) =>
          destroyUpload(item.publicId, item.resourceType),
        ),
      );
      throw new AppError(
        400,
        "FILE_TOO_LARGE",
        `${attachment.name} is larger than 10 MB`,
      );
    }
  }

  // Only people actually in the conversation can be mentioned.
  const mentions = [...new Set(input.mentionIds ?? [])].filter(
    (id) => id !== me && everyone.includes(id),
  );

  const now = new Date();
  const message = await Message.create({
    conversationId: conversation._id,
    senderId: me,
    text: input.text,
    replyToId: input.replyToId ?? null,
    mentions,
    attachments: attachments.map((attachment) => ({
      url: attachment.url,
      publicId: attachment.publicId,
      resourceType: attachment.resourceType,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  });

  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": me },
    {
      $set: {
        lastMessageAt: message.createdAt ?? now,
        lastMessage: {
          senderId: me,
          text: input.text.slice(0, 200),
          hasAttachment: attachments.length > 0,
          deleted: false,
          system: false,
        },
        "members.$.lastReadAt": message.createdAt ?? now,
      },
    },
  );

  const people = await loadPeople([me]);
  notifyConversation(
    everyone.filter((id) => inOrg.has(id)),
    {
      kind: "message",
      conversationId,
      messageId: String(message._id),
      senderId: me,
      senderName: people.get(me)?.name ?? "Someone",
      preview: previewOf({ text: input.text, attachments }),
      mentions,
    },
  );

  return { message: await serializeOneMessage(message._id) };
}

async function findMyMessage(messageId: string) {
  const message = await Message.findOne({ _id: messageId }).lean();
  if (!message) throw new AppError(404, "NOT_FOUND", "Message not found");
  const conversation = await findMine(String(message.conversationId));
  return { message, conversation };
}

export async function editMessage(messageId: string, text: string) {
  const { message, conversation } = await findMyMessage(messageId);
  if (message.kind !== "user" || String(message.senderId) !== myId()) {
    throw new AppError(403, "FORBIDDEN", "You can only edit your own messages");
  }
  if (message.deletedAt) {
    throw new AppError(409, "MESSAGE_DELETED", "This message was deleted");
  }
  if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
    throw new AppError(
      403,
      "EDIT_WINDOW_EXPIRED",
      "Messages can only be edited for 10 minutes after sending",
    );
  }
  await Message.updateOne({ _id: message._id }, { text, editedAt: new Date() });

  const latest = await Conversation.findOne({
    _id: conversation._id,
    lastMessageAt: message.createdAt,
  }).lean();
  if (latest) {
    await Conversation.updateOne(
      { _id: conversation._id },
      { "lastMessage.text": text.slice(0, 200) },
    );
  }
  notifyConversation(memberIds(conversation), {
    kind: "updated",
    conversationId: String(conversation._id),
    messageId,
  });
  return { message: await serializeOneMessage(message._id) };
}

export async function deleteMessage(messageId: string) {
  const { message, conversation } = await findMyMessage(messageId);
  if (message.kind !== "user" || String(message.senderId) !== myId()) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You can only delete your own messages",
    );
  }
  if (!message.deletedAt) {
    await Message.updateOne(
      { _id: message._id },
      { deletedAt: new Date(), text: "", attachments: [], reactions: [] },
    );
    await Conversation.updateOne(
      { _id: conversation._id, lastMessageAt: message.createdAt },
      { "lastMessage.deleted": true, "lastMessage.text": "" },
    );
    for (const attachment of message.attachments) {
      void destroyUpload(attachment.publicId, attachment.resourceType);
    }
  }
  notifyConversation(memberIds(conversation), {
    kind: "deleted",
    conversationId: String(conversation._id),
    messageId,
  });
  return { message: await serializeOneMessage(message._id) };
}

export async function toggleReaction(messageId: string, emoji: string) {
  const me = myId();
  const { message, conversation } = await findMyMessage(messageId);
  if (message.kind !== "user" || message.deletedAt) {
    throw new AppError(409, "MESSAGE_DELETED", "You can't react to this");
  }
  const existing = message.reactions.find((r) => r.emoji === emoji);
  const hasReacted = existing?.userIds.map(String).includes(me) ?? false;

  if (hasReacted) {
    await Message.updateOne(
      { _id: message._id, "reactions.emoji": emoji },
      { $pull: { "reactions.$.userIds": oid(me) } },
    );
    await Message.updateOne(
      { _id: message._id },
      { $pull: { reactions: { userIds: { $size: 0 } } } },
    );
  } else if (existing) {
    await Message.updateOne(
      { _id: message._id, "reactions.emoji": emoji },
      { $addToSet: { "reactions.$.userIds": oid(me) } },
    );
  } else {
    await Message.updateOne(
      { _id: message._id },
      { $push: { reactions: { emoji, userIds: [oid(me)] } } },
    );
  }
  notifyConversation(memberIds(conversation), {
    kind: "updated",
    conversationId: String(conversation._id),
    messageId,
  });
  return { message: await serializeOneMessage(message._id) };
}

export async function markConversationRead(conversationId: string) {
  const conversation = await findMine(conversationId);
  const now = new Date();
  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": myId() },
    { $set: { "members.$.lastReadAt": now } },
  );
  notifyConversation(memberIds(conversation), {
    kind: "read",
    conversationId,
    userId: myId(),
  });
}

// ---- Presence and attachments ------------------------------------------

export async function listOnlineMembers() {
  const memberships = await Membership.find({}).select("userId").lean();
  return {
    onlineUserIds: memberships
      .map((membership) => String(membership.userId))
      .filter(isUserOnline),
  };
}

export function getChatConfig() {
  return { attachments: isCloudinaryConfigured() };
}

export function signAttachmentUpload() {
  if (!isCloudinaryConfigured()) {
    throw new AppError(
      503,
      "ATTACHMENTS_DISABLED",
      "File attachments are not set up for this workspace",
    );
  }
  logger.debug("Issuing attachment upload signature");
  return createUploadSignature(`worknest/${requireTenantId()}/chat`);
}

// ---- Mute, search ------------------------------------------------------

export async function setConversationMuted(
  conversationId: string,
  muted: boolean,
) {
  const conversation = await findMine(conversationId);
  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": myId() },
    { $set: { "members.$.mutedAt": muted ? new Date() : null } },
  );
  return { conversation: await serializeOne(conversationId) };
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Looks only through conversations you're in, newest matches first.
export async function searchMessages(query: string) {
  const conversations = await Conversation.find({ "members.userId": myId() })
    .select("_id members")
    .lean();
  if (conversations.length === 0) return { results: [] };
  // Messages from before a chat was cleared are out of reach too.
  const found = await Message.find({
    $or: conversations.map((conversation) => {
      const cleared = myClearedAt(conversation as never);
      return {
        conversationId: conversation._id,
        ...(cleared ? { createdAt: { $gt: cleared } } : {}),
      };
    }),
    kind: "user",
    deletedAt: null,
    text: { $regex: escapeRegex(query), $options: "i" },
  })
    .sort({ _id: -1 })
    .limit(30)
    .select("conversationId senderId text createdAt")
    .lean();
  const people = await loadPeople(found.map((m) => String(m.senderId)));
  return {
    results: found.map((message) => ({
      id: String(message._id),
      conversationId: String(message.conversationId),
      senderId: String(message.senderId),
      senderName: people.get(String(message.senderId))?.name ?? "Former member",
      text: message.text,
      createdAt: message.createdAt,
    })),
  };
}

// ---- Mark unread, delete for me ------------------------------------------

// Brings the unread badge back by moving "read up to" to just before the
// newest message from someone else. Does nothing if there isn't one.
export async function markConversationUnread(conversationId: string) {
  const conversation = await findMine(conversationId);
  const cleared = myClearedAt(conversation);
  const latest = await Message.findOne({
    conversationId: conversation._id,
    senderId: { $ne: myId() },
    kind: "user",
    deletedAt: null,
    ...(cleared ? { createdAt: { $gt: cleared } } : {}),
  })
    .sort({ _id: -1 })
    .select("createdAt")
    .lean();
  if (latest) {
    await Conversation.updateOne(
      { _id: conversation._id, "members.userId": myId() },
      {
        $set: {
          "members.$.lastReadAt": new Date(latest.createdAt.getTime() - 1),
        },
      },
    );
  }
  emitToUsers([myId()], "chat:event", {
    orgId: requireTenantId(),
    kind: "conversation",
    conversationId,
  });
}

// "Delete conversation" only ever clears it for the person asking. The others
// keep the chat and its history, and a new message brings it back for this
// person with nothing from before.
export async function clearConversationForMe(conversationId: string) {
  const conversation = await findMine(conversationId);
  const now = new Date();
  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": myId() },
    { $set: { "members.$.clearedAt": now, "members.$.lastReadAt": now } },
  );
  emitToUsers([myId()], "chat:event", {
    orgId: requireTenantId(),
    kind: "conversation",
    conversationId,
  });
}

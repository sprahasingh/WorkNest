import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "😮",
  "😢",
  "🙏",
  "👀",
] as const;

export const MAX_GROUP_MEMBERS = 50;
export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const conversationIdParamsSchema = z.object({
  conversationId: objectId,
});
export const messageIdParamsSchema = z.object({ messageId: objectId });
export const conversationMemberParamsSchema = z.object({
  conversationId: objectId,
  userId: objectId,
});

export const createConversationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("direct"), userId: objectId }).strict(),
  z
    .object({
      type: z.literal("group"),
      name: z.string().trim().min(1).max(80),
      memberIds: z
        .array(objectId)
        .min(1)
        .max(MAX_GROUP_MEMBERS - 1),
    })
    .strict(),
]);
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const renameConversationSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

export const addMembersSchema = z
  .object({ userIds: z.array(objectId).min(1).max(MAX_GROUP_MEMBERS) })
  .strict();

export const listMessagesQuerySchema = z
  .object({
    before: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

const attachmentSchema = z
  .object({
    url: z.string().url().max(500),
    publicId: z.string().min(1).max(300),
    resourceType: z.enum(["image", "video", "raw"]),
    name: z.string().trim().min(1).max(200),
    mimeType: z.string().max(120).optional(),
    size: z
      .number()
      .int()
      .min(0)
      .max(100 * 1024 * 1024)
      .optional(),
  })
  .strict();
export type AttachmentInput = z.infer<typeof attachmentSchema>;

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(4000).default(""),
    replyToId: objectId.optional(),
    mentionIds: z.array(objectId).max(20).optional(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  })
  .strict()
  .refine((value) => value.text.length > 0 || value.attachments?.length, {
    message: "Write a message or attach a file",
    path: ["text"],
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z
  .object({ text: z.string().trim().min(1).max(4000) })
  .strict();

export const reactSchema = z
  .object({ emoji: z.enum(REACTION_EMOJIS) })
  .strict();

export const muteSchema = z.object({ muted: z.boolean() }).strict();

export const searchQuerySchema = z
  .object({ q: z.string().trim().min(2).max(100) })
  .strict();

import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    resourceType: {
      type: String,
      enum: ["image", "video", "raw"],
      default: "raw",
    },
  },
  { _id: false },
);

const reactionSchema = new Schema(
  {
    emoji: { type: String, required: true },
    userIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    // "system" rows are group events such as "Sam added Priya".
    kind: { type: String, enum: ["user", "system"], default: "user" },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "", maxlength: 4000 },
    replyToId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    attachments: { type: [attachmentSchema], default: [] },
    reactions: { type: [reactionSchema], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    // People who deleted this message for themselves. Everyone else still sees it.
    hiddenBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

messageSchema.index({ tenantId: 1, conversationId: 1, _id: -1 });
// Lets the retention sweep find old messages without reading everything.
messageSchema.index({ tenantId: 1, createdAt: 1 });

messageSchema.plugin(tenantPlugin);

export type MessageDocument = InferSchemaType<typeof messageSchema>;
export const Message = model("Message", messageSchema);

import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Everything sent before this moment counts as read for this person.
    lastReadAt: { type: Date, default: Date.now },
    joinedAt: { type: Date, default: Date.now },
    mutedAt: { type: Date, default: null },
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    type: { type: String, enum: ["direct", "group"], required: true },
    name: { type: String, trim: true, maxlength: 80, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    adminIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    members: { type: [memberSchema], default: [] },
    // Sorted "userA:userB" for direct chats, so each pair has one thread.
    directKey: { type: String, default: null },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessage: {
      type: new Schema(
        {
          senderId: { type: Schema.Types.ObjectId, ref: "User" },
          text: { type: String, default: "" },
          hasAttachment: { type: Boolean, default: false },
          deleted: { type: Boolean, default: false },
          system: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

conversationSchema.index({
  tenantId: 1,
  "members.userId": 1,
  lastMessageAt: -1,
});
conversationSchema.index(
  { tenantId: 1, directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: "string" } } },
);

conversationSchema.plugin(tenantPlugin);

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;
export const Conversation = model("Conversation", conversationSchema);

import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const taskActivitySchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    // A workspace request is one thread visible from each qualifying project.
    projectIds: [{ type: Schema.Types.ObjectId, ref: "Project" }],
    projectNames: [{ type: String }],
    sharedParticipantIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // null for project-wide activity, e.g. an update request sent to every
    // assignee in the project.
    taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["update_request", "update", "question", "reply"],
      required: true,
    },
    content: { type: String, trim: true, maxlength: 2000 },
    // People named or role-mentioned here. Being mentioned lets someone
    // reply in this thread even if they aren't assigned.
    mentionIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Replies: the message that started the thread, and the one being
    // answered (the same unless replying to a reply). null for new messages.
    parentId: { type: Schema.Types.ObjectId, default: null },
    replyToId: { type: Schema.Types.ObjectId, default: null },
    // Update requests: who was asked, so the thread can show who has
    // replied and who it's still waiting on.
    askedIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // false when the message went only to the people mentioned in it. Then
    // only they and the author can reply. Replies follow their thread.
    notifyAll: { type: Boolean, default: true },
    // Questions: the reply the asker marked as the answer.
    answerId: { type: Schema.Types.ObjectId, default: null },
    // Update requests: when the requester last nudged the people who
    // haven't replied, so reminders can't be sent over and over.
    remindedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

taskActivitySchema.index({ tenantId: 1, taskId: 1, _id: -1 });
taskActivitySchema.index({ tenantId: 1, projectId: 1, taskId: 1, _id: -1 });
taskActivitySchema.index({ tenantId: 1, parentId: 1 });
taskActivitySchema.plugin(tenantPlugin);

export type TaskActivityDocument = InferSchemaType<typeof taskActivitySchema>;
export const TaskActivity = model("TaskActivity", taskActivitySchema);

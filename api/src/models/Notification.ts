import { Schema, model, type InferSchemaType } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    dueDate: { type: Date, default: null },
    activityId: {
      type: Schema.Types.ObjectId,
      ref: "TaskActivity",
      default: null,
    },
    // What happened, so the UI can label it; null on older notifications.
    type: {
      type: String,
      enum: [
        "update_request",
        "update",
        "question",
        "reply",
        "task_assigned",
        "task_completed",
        "task_due_soon",
        "task_overdue",
        "project_due_soon",
        "project_overdue",
      ],
      default: null,
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    message: { type: String, required: true },
    readAt: { type: Date, default: null },
    dismissedAt: { type: Date, default: null },
    eventKey: { type: String, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, tenantId: 1, readAt: 1, _id: -1 });
notificationSchema.index(
  { userId: 1, eventKey: 1 },
  {
    unique: true,
    partialFilterExpression: { eventKey: { $type: "string" } },
  },
);

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;
export const Notification = model("Notification", notificationSchema);

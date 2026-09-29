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
    activityId: {
      type: Schema.Types.ObjectId,
      ref: "TaskActivity",
      required: true,
    },
    // What happened, so the UI can label it; null on older notifications.
    type: {
      type: String,
      enum: ["update_request", "update", "question", "reply"],
      default: null,
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    message: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, tenantId: 1, readAt: 1, _id: -1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;
export const Notification = model("Notification", notificationSchema);

import { Schema, model, type InferSchemaType } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    activityId: {
      type: Schema.Types.ObjectId,
      ref: "TaskActivity",
      required: true,
    },
    message: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, tenantId: 1, readAt: 1, _id: -1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;
export const Notification = model("Notification", notificationSchema);

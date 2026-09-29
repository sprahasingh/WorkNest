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
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["update_request", "update", "question"],
      required: true,
    },
    content: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

taskActivitySchema.index({ tenantId: 1, taskId: 1, _id: -1 });
taskActivitySchema.plugin(tenantPlugin);

export type TaskActivityDocument = InferSchemaType<typeof taskActivitySchema>;
export const TaskActivity = model("TaskActivity", taskActivitySchema);

import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const taskSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: {
      type: String,
      enum: ["todo", "in_progress", "done"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    dueDate: { type: Date, default: null },
    dueDateIsDateOnly: { type: Boolean, default: false },
    reminderCycle: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

taskSchema.index({ tenantId: 1, projectId: 1, status: 1, _id: -1 });
taskSchema.index({ tenantId: 1, projectId: 1, completedAt: -1, _id: -1 });
taskSchema.index({ tenantId: 1, projectId: 1, archivedAt: -1, _id: -1 });
taskSchema.index({ tenantId: 1, assigneeIds: 1, status: 1 });
taskSchema.index({ tenantId: 1, projectId: 1, deletedAt: -1, _id: -1 });
// The hourly bin cleanup looks across organizations by deletion date.
taskSchema.index({ deletedAt: 1 }, { sparse: true });
// The dashboard finds when an organization's first task was created.
taskSchema.index({ tenantId: 1, createdAt: 1 });

taskSchema.pre(
  [
    "find",
    "findOne",
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndReplace",
    "updateOne",
    "updateMany",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "countDocuments",
    "distinct",
  ],
  function () {
    const options = this.getOptions() as { includeDeleted?: boolean };
    if (!options.includeDeleted && this.getFilter().deletedAt === undefined) {
      this.where({ deletedAt: null });
    }
  },
);

taskSchema.plugin(tenantPlugin);

export type TaskDocument = InferSchemaType<typeof taskSchema>;
export const Task = model("Task", taskSchema);

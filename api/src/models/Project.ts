import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const projectSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    key: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true, maxlength: 500 },
    dueDate: { type: Date, default: null },
    dueDateIsDateOnly: { type: Boolean, default: false },
    reminderCycle: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
    // Set when the project is moved to the bin; it's permanently deleted
    // BIN_RETENTION_DAYS later unless restored.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

projectSchema.index({ tenantId: 1, key: 1 }, { unique: true });
projectSchema.index({ deletedAt: 1 });

export const BIN_RETENTION_DAYS = 30;

// Projects in the bin are invisible to every normal lookup, so their board,
// tasks and updates can't be reached. Pass { includeDeleted: true } to see them.
projectSchema.pre(
  ["find", "findOne", "countDocuments", "findOneAndUpdate"],
  function () {
    const options = this.getOptions() as { includeDeleted?: boolean };
    if (!options.includeDeleted && this.getFilter().deletedAt === undefined) {
      this.where({ deletedAt: null });
    }
  },
);
projectSchema.plugin(tenantPlugin);
export type ProjectDocument = InferSchemaType<typeof projectSchema>;
export const Project = model("Project", projectSchema);

// Ids of this org's projects in the bin, to leave their tasks and
// notifications out of counts and lists.
export async function binnedProjectIds() {
  return Project.find({ deletedAt: { $ne: null } }).distinct("_id");
}

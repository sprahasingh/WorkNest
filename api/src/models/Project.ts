import { Schema, model, type InferSchemaType } from "mongoose";

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
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

projectSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export type ProjectDocument = InferSchemaType<typeof projectSchema>;
export const Project = model("Project", projectSchema);

import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const userPreferenceSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // "projects" for the organization's project list, or a project id for
    // that project's task board.
    context: { type: String, required: true },
    view: {
      type: String,
      enum: ["active", "completed", "archived", "bin"],
      required: true,
    },
    sort: { type: String, required: true },
  },
  { timestamps: true },
);

userPreferenceSchema.index(
  { tenantId: 1, userId: 1, context: 1, view: 1 },
  { unique: true },
);
userPreferenceSchema.plugin(tenantPlugin);

export type UserPreferenceDocument = InferSchemaType<
  typeof userPreferenceSchema
>;
export const UserPreference = model("UserPreference", userPreferenceSchema);

import { Schema, model, type InferSchemaType } from "mongoose";
import { ROLES } from "../constants/roles.js";
import { tenantPlugin } from "../tenancy/plugin.js";

const membershipSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: {
      type: String,
      enum: ROLES,
      required: true,
    },
    onboardingSeenAt: { type: Date, default: null },
    onboardingSeenForRole: {
      type: String,
      enum: [...ROLES, null],
      default: null,
    },
    // Projects and tasks this person has muted. Muting stops general
    // chatter from them; anything addressed to the person still arrives.
    // Hidden by default so member lists don't expose them.
    mutedProjectIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Project" }],
      default: [],
      select: false,
    },
    mutedTaskIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Task" }],
      default: [],
      select: false,
    },
    // Personal preference to mute general activity from every project.
    mutedAllProjects: { type: Boolean, default: false, select: false },
  },
  { timestamps: true },
);

membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });

membershipSchema.plugin(tenantPlugin);

export type MembershipDocument = InferSchemaType<typeof membershipSchema>;
export const Membership = model("Membership", membershipSchema);

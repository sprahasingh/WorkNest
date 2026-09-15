import { Schema, model, type InferSchemaType } from "mongoose";
import { ROLES } from "../constants/roles.js";

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
  },
  { timestamps: true },
);

membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });

export type MembershipDocument = InferSchemaType<typeof membershipSchema>;
export const Membership = model("Membership", membershipSchema);

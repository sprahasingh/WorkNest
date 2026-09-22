import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

const inviteSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: ["admin", "manager", "member"],
      required: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked", "expired"],
      default: "pending",
    },
  },
  { timestamps: true },
);

inviteSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

inviteSchema.plugin(tenantPlugin);

export type InviteDocument = InferSchemaType<typeof inviteSchema>;
export const Invite = model("Invite", inviteSchema);

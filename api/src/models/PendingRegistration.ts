import { Schema, model, type InferSchemaType } from "mongoose";

const pendingRegistrationSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    kind: {
      type: String,
      enum: ["organization", "invite"],
      required: true,
      default: "organization",
    },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    orgName: { type: String, default: null },
    inviteId: { type: Schema.Types.ObjectId, ref: "Invite", default: null },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export type PendingRegistrationDocument = InferSchemaType<
  typeof pendingRegistrationSchema
>;
export const PendingRegistration = model(
  "PendingRegistration",
  pendingRegistrationSchema,
);

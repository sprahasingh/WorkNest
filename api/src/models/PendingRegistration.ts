import { Schema, model, type InferSchemaType } from "mongoose";

const pendingRegistrationSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    kind: {
      type: String,
      enum: ["organization", "user", "invite"],
      required: true,
      default: "organization",
    },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    orgName: { type: String, default: null },
    inviteId: { type: Schema.Types.ObjectId, ref: "Invite", default: null },
    tokenHash: { type: String, required: true, unique: true, select: false },
    // Only the browser that started sign-up knows the secret behind this
    // hash. It lets that browser sign in by itself once the email link has been
    // opened on any device.
    signupSecretHash: { type: String, default: null, select: false },
    // When the verification email was last sent, so "resend" can't be spammed.
    lastSentAt: { type: Date, default: null },
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

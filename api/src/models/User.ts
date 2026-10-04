import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    emailVerifiedAt: { type: Date, default: null },
    // Set once the person has finished or skipped the first-run tour, so it
    // shows once per account instead of once per browser.
    onboardingSeenAt: { type: Date, default: null },
    pendingEmail: { type: String, default: null, select: false },
    emailChangeTokenHash: { type: String, default: null, select: false },
    emailChangeExpiresAt: { type: Date, default: null, select: false },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      select: false,
    },
    deletedAt: { type: Date, default: null, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as Record<string, unknown>;
        delete obj.passwordHash;
        delete obj.emailChangeTokenHash;
        delete obj.emailChangeExpiresAt;
        delete obj.passwordResetTokenHash;
        delete obj.passwordResetExpiresAt;
        delete obj.__v;
        obj.id = obj._id;
        delete obj._id;
        return obj;
      },
    },
  },
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);

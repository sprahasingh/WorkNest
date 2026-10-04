import { Schema, model, type InferSchemaType } from "mongoose";

// Left behind when an email link is opened for a sign-up that has a secret.
// The browser that started the sign-up swaps its secret for a session, once.
const signupClaimSchema = new Schema(
  {
    secretHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export type SignupClaimDocument = InferSchemaType<typeof signupClaimSchema>;
export const SignupClaim = model("SignupClaim", signupClaimSchema);

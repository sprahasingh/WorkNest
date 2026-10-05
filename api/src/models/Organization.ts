import { Schema, model, type InferSchemaType } from "mongoose";
import { PLANS } from "../constants/plans.js";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    timeZone: { type: String, required: true, default: "UTC" },
    plan: { type: String, enum: PLANS, default: "free" },
    // When a paid plan ends. Null means it doesn't end (free, or an older
    // paid plan from before plans expired).
    planExpiresAt: { type: Date, default: null },
    // Set when a paid plan ran out and the organization went back to Free, so
    // the app can tell people why. Cleared on the next upgrade.
    planExpiredAt: { type: Date, default: null },
    planExpiredFrom: { type: String, enum: PLANS, default: null },
    seatLimit: { type: Number, required: true, default: 5 },
    seatsUsed: { type: Number, required: true, default: 1 },
    projectLimit: { type: Number, required: true, default: 3 },
    projectCount: { type: Number, required: true, default: 0 },
    adminCount: { type: Number, required: true, default: 1 },
    // Chat messages older than this many days are deleted; null keeps them.
    chatRetentionDays: { type: Number, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as Record<string, unknown>;
        delete obj.__v;
        obj.id = obj._id;
        delete obj._id;
        return obj;
      },
    },
  },
);

export type OrganizationDocument = InferSchemaType<typeof organizationSchema>;
export const Organization = model("Organization", organizationSchema);

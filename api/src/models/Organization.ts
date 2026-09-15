import { Schema, model, type InferSchemaType } from "mongoose";
import { PLANS } from "../constants/plans.js";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    plan: { type: String, enum: PLANS, default: "free" },
    seatLimit: { type: Number, required: true, default: 5 },
    seatsUsed: { type: Number, required: true, default: 1 },
    projectLimit: { type: Number, required: true, default: 3 },
    projectCount: { type: Number, required: true, default: 0 },
    adminCount: { type: Number, required: true, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export type OrganizationDocument = InferSchemaType<typeof organizationSchema>;
export const Organization = model("Organization", organizationSchema);

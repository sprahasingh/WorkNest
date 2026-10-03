import { Schema, model, type InferSchemaType } from "mongoose";
import { tenantPlugin } from "../tenancy/plugin.js";

export const RSVP_RESPONSES = [
  "pending",
  "accepted",
  "tentative",
  "declined",
] as const;

const attendeeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    response: { type: String, enum: RSVP_RESPONSES, default: "pending" },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

const proposalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    note: { type: String, default: "", maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

const meetingSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    organizerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    agenda: { type: String, default: "", maxlength: 4000 },
    notes: { type: String, default: "", maxlength: 8000 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    joinUrl: { type: String, default: null, maxlength: 500 },
    location: { type: String, default: "", trim: true, maxlength: 200 },
    attendees: { type: [attendeeSchema], default: [] },
    cancelledAt: { type: Date, default: null },
    // Repeating meetings are stored as one row per occurrence, sharing a
    // series id, so each one can have its own replies and notes.
    seriesId: { type: Schema.Types.ObjectId, default: null },
    seriesIndex: { type: Number, default: null },
    seriesCount: { type: Number, default: null },
    recurrence: {
      type: String,
      enum: [...RECURRENCE_FREQUENCIES, null],
      default: null,
    },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    proposals: { type: [proposalSchema], default: [] },
  },
  { timestamps: true },
);

meetingSchema.index({ tenantId: 1, "attendees.userId": 1, startsAt: 1 });
meetingSchema.index({ tenantId: 1, organizerId: 1, startsAt: 1 });
meetingSchema.index({ startsAt: 1, cancelledAt: 1 });
meetingSchema.index({ tenantId: 1, seriesId: 1, startsAt: 1 });
meetingSchema.index({ tenantId: 1, taskId: 1 });
meetingSchema.index({ tenantId: 1, projectId: 1 });

meetingSchema.plugin(tenantPlugin);

export type MeetingDocument = InferSchemaType<typeof meetingSchema>;
export const Meeting = model("Meeting", meetingSchema);

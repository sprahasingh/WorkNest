import { Schema, model } from "mongoose";

// One row per background job. Whoever pushes "locked until" forward owns the
// current run, so when the API runs on several servers a sweep happens once
// per tick, not once per server.
const jobLockSchema = new Schema({
  _id: { type: String, required: true },
  lockedUntil: { type: Date, required: true },
});

export const JobLock = model("JobLock", jobLockSchema);

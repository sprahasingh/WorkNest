import { JobLock } from "../models/JobLock.js";

// Runs `job` unless another server already claimed this tick. The claim simply
// expires, so a server that crashes mid-run never blocks the next one for long.
// Jobs must still be safe to repeat: a slow run can overlap the next claim.
export async function runExclusive(
  name: string,
  claimMs: number,
  job: () => Promise<unknown>,
): Promise<boolean> {
  const now = new Date();
  try {
    await JobLock.findOneAndUpdate(
      { _id: name, lockedUntil: { $lte: now } },
      { $set: { lockedUntil: new Date(now.getTime() + claimMs) } },
      { upsert: true },
    );
  } catch (error) {
    // The row exists and is still locked, so the upsert collides with it.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
  await job();
  return true;
}

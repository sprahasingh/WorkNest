import { env } from "../config/env.js";

// Every limit goes through here so the test-only RATE_LIMIT_SCALE applies to
// all of them at once.
export function scaled(limit: number): number {
  return Math.round(limit * env.RATE_LIMIT_SCALE);
}

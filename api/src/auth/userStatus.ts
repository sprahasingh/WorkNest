import { User } from "../models/User.js";

// An access token lasts 15 minutes, so a deleted account would keep working
// for that long. Looking the account up on every request would cost a query
// each time, so the answer is remembered for a short while.
const TTL_MS = 30_000;
const cache = new Map<string, { active: boolean; until: number }>();

export async function isAccountActive(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  const now = Date.now();
  if (hit && hit.until > now) return hit.active;
  const user = await User.findById(userId).select("status").lean();
  const active = !!user && (user as { status?: string }).status !== "deleted";
  cache.set(userId, { active, until: now + TTL_MS });
  if (cache.size > 5_000) cache.clear();
  return active;
}

// Called as soon as an account is deleted, so it stops working at once on this
// server instead of when the remembered answer runs out.
export function forgetAccountStatus(userId: string): void {
  cache.delete(userId);
}

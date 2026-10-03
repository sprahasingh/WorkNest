import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const ISSUER = "worknest-api";
const AUDIENCE = "worknest-file";
// Links last 10 to 20 minutes. They're rounded to a time slot so the same
// file keeps the same link for a while, and the browser can cache it.
const SLOT_SECONDS = 10 * 60;

export interface FileTokenPayload {
  sub: string;
  org: string;
  mid: string;
  i: number;
}

export function signFileToken(
  claims: { userId: string; orgId: string; messageId: string; index: number },
  now = Date.now(),
): string {
  const exp = (Math.floor(now / 1000 / SLOT_SECONDS) + 2) * SLOT_SECONDS;
  return jwt.sign(
    {
      sub: claims.userId,
      org: claims.orgId,
      mid: claims.messageId,
      i: claims.index,
      exp,
    },
    env.JWT_ACCESS_SECRET,
    { issuer: ISSUER, audience: AUDIENCE, noTimestamp: true },
  );
}

export function verifyFileToken(token: string): FileTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as unknown as FileTokenPayload;
}

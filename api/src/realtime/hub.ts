import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { Conversation } from "../models/Conversation.js";
import { Membership } from "../models/Membership.js";
import { runWithTenant } from "../tenancy/context.js";

let io: Server | null = null;
const onlineCounts = new Map<string, number>();

const userRoom = (userId: string) => `user:${userId}`;

export function isUserOnline(userId: string): boolean {
  return (onlineCounts.get(userId) ?? 0) > 0;
}

// Does nothing until the socket server is started (always the case in tests),
// so callers never need to check.
export function emitToUsers(
  userIds: Iterable<string>,
  event: string,
  payload: unknown,
): void {
  if (!io) return;
  for (const userId of userIds) {
    io.to(userRoom(userId)).emit(event, payload);
  }
}

export function startRealtime(server: HttpServer): void {
  io = new Server(server, {
    path: "/socket.io",
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof token !== "string") {
      next(new Error("TOKEN_INVALID"));
      return;
    }
    try {
      socket.data.userId = verifyAccessToken(token).sub;
      next();
    } catch {
      next(new Error("TOKEN_INVALID"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(userRoom(userId));
    onlineCounts.set(userId, (onlineCounts.get(userId) ?? 0) + 1);

    let lastTypingAt = 0;
    socket.on("chat:typing", (payload: unknown) => {
      // The app sends these every couple of seconds; anything faster is
      // ignored so a misbehaving client can't hammer the database.
      const now = Date.now();
      if (now - lastTypingAt < 1_000) return;
      lastTypingAt = now;
      const { orgId, conversationId } = (payload ?? {}) as {
        orgId?: unknown;
        conversationId?: unknown;
      };
      if (
        typeof orgId !== "string" ||
        typeof conversationId !== "string" ||
        !mongoose.Types.ObjectId.isValid(orgId) ||
        !mongoose.Types.ObjectId.isValid(conversationId)
      ) {
        return;
      }
      void relayTyping(userId, orgId, conversationId).catch((error: unknown) =>
        logger.warn({ error }, "Typing relay failed"),
      );
    });

    socket.on("disconnect", () => {
      const left = (onlineCounts.get(userId) ?? 1) - 1;
      if (left <= 0) onlineCounts.delete(userId);
      else onlineCounts.set(userId, left);
    });
  });
}

async function relayTyping(
  userId: string,
  orgId: string,
  conversationId: string,
): Promise<void> {
  const membership = await Membership.findOne({
    tenantId: new mongoose.Types.ObjectId(orgId),
    userId: new mongoose.Types.ObjectId(userId),
  })
    .setOptions({ skipTenant: true })
    .lean();
  if (!membership) return;

  await runWithTenant({ tenantId: orgId, userId }, async () => {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      "members.userId": userId,
    }).lean();
    if (!conversation) return;
    emitToUsers(
      conversation.members
        .map((member) => String(member.userId))
        .filter((id) => id !== userId),
      "chat:typing",
      { orgId, conversationId, userId },
    );
  });
}

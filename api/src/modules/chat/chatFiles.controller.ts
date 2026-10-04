import { Readable } from "node:stream";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { AppError } from "../../lib/errors.js";
import { signedDeliveryUrl } from "../../lib/cloudinary.js";
import { verifyFileToken, type FileTokenPayload } from "../../lib/fileToken.js";
import { Conversation } from "../../models/Conversation.js";
import { Membership } from "../../models/Membership.js";
import { Message } from "../../models/Message.js";
import { runWithTenant } from "../../tenancy/context.js";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// Shown in the browser's own viewer or player instead of being downloaded.
// These can't run code on this origin, and the type is always the one chosen
// here (never what the uploader sent) with sniffing turned off.
const VIEWER_TYPES = new Set([
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const TEXT_TYPES = new Set(["text/plain"]);

const notFound = () => new AppError(404, "NOT_FOUND", "File not found");

function readToken(token: string): FileTokenPayload {
  try {
    const payload = verifyFileToken(token);
    if (
      !mongoose.Types.ObjectId.isValid(payload.sub) ||
      !mongoose.Types.ObjectId.isValid(payload.org) ||
      !mongoose.Types.ObjectId.isValid(payload.mid) ||
      !Number.isInteger(payload.i)
    ) {
      throw notFound();
    }
    return payload;
  } catch {
    throw notFound();
  }
}

// Opens a chat file. The link in the page is a short-lived token rather than
// a login, so this checks everything again: the person is still in the
// organization and the conversation, and the message hasn't been deleted.
export async function downloadChatFileController(
  req: Request,
  res: Response,
): Promise<void> {
  const payload = readToken(String(req.params.token));

  const membership = await Membership.findOne({
    tenantId: new mongoose.Types.ObjectId(payload.org),
    userId: new mongoose.Types.ObjectId(payload.sub),
  })
    .setOptions({ skipTenant: true })
    .lean();
  if (!membership) throw notFound();

  const attachment = await runWithTenant(
    { tenantId: payload.org, userId: payload.sub, role: membership.role },
    async () => {
      // Not for a message this person deleted for themselves.
      const message = await Message.findOne({
        _id: payload.mid,
        deletedAt: null,
        hiddenBy: { $ne: new mongoose.Types.ObjectId(payload.sub) },
      }).lean();
      if (!message) return null;
      const conversation = await Conversation.findOne({
        _id: message.conversationId,
        "members.userId": payload.sub,
      })
        .select("_id")
        .lean();
      return conversation ? (message.attachments[payload.i] ?? null) : null;
    },
  );
  if (!attachment) throw notFound();

  const upstream = await fetch(
    signedDeliveryUrl(attachment.publicId, attachment.resourceType),
  );
  if (!upstream.ok || !upstream.body) {
    throw new AppError(502, "FILE_UNAVAILABLE", "The file couldn't be loaded");
  }

  // "?download=1" is the Download button; opening the file otherwise shows it
  // in the browser when the browser can.
  const wantsDownload = req.query.download === "1";
  const type = attachment.mimeType;
  const inline =
    !wantsDownload &&
    (IMAGE_TYPES.has(type) || VIEWER_TYPES.has(type) || TEXT_TYPES.has(type));
  res.status(200);
  res.setHeader("Content-Type", inline ? type : "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  // The browser's PDF viewer and media players don't work inside a sandbox, so
  // those are served without one. Everything else stays fully locked down.
  if (!(inline && VIEWER_TYPES.has(type))) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "private, max-age=300");
  const length = upstream.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);

  Readable.fromWeb(upstream.body as never).pipe(res);
}

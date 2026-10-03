import mongoose from "mongoose";
import { destroyUpload } from "../../lib/cloudinary.js";
import { logger } from "../../lib/logger.js";
import { Conversation } from "../../models/Conversation.js";
import { Message } from "../../models/Message.js";
import { Organization } from "../../models/Organization.js";

const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

interface OldMessage {
  _id: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  attachments?: { publicId: string; resourceType: string }[];
}

// Deletes chat messages (and their files) older than each organization's
// chosen limit. Organizations that haven't set one are left alone. Raw
// collection access: this sweep spans every organization on purpose.
export async function purgeExpiredChatMessages(
  now = Date.now(),
): Promise<number> {
  const organizations = await Organization.collection
    .find({ chatRetentionDays: { $gt: 0 } })
    .project<{ _id: mongoose.Types.ObjectId; chatRetentionDays: number }>({
      chatRetentionDays: 1,
    })
    .toArray();

  let removed = 0;
  for (const organization of organizations) {
    const cutoff = new Date(now - organization.chatRetentionDays * DAY_MS);
    for (;;) {
      const old = await Message.collection
        .find<OldMessage>({
          tenantId: organization._id,
          createdAt: { $lt: cutoff },
        })
        .project({ conversationId: 1, attachments: 1 })
        .limit(BATCH)
        .toArray();
      if (old.length === 0) break;

      await Message.collection.deleteMany({
        _id: { $in: old.map((m) => m._id) },
      });
      removed += old.length;
      for (const message of old) {
        for (const file of message.attachments ?? []) {
          await destroyUpload(file.publicId, file.resourceType);
        }
      }

      // Conversations whose latest message just went need a new preview.
      for (const conversationId of new Set(
        old.map((m) => String(m.conversationId)),
      )) {
        const latest = await Message.collection.findOne(
          { conversationId: new mongoose.Types.ObjectId(conversationId) },
          { sort: { _id: -1 } },
        );
        await Conversation.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(conversationId) },
          {
            $set: {
              lastMessage: latest
                ? {
                    senderId: latest.senderId,
                    text: String(latest.text ?? "").slice(0, 200),
                    hasAttachment: (latest.attachments ?? []).length > 0,
                    deleted: latest.deletedAt != null,
                    system: latest.kind === "system",
                  }
                : null,
            },
          },
        );
      }
    }
  }
  if (removed > 0) logger.info({ removed }, "Removed old chat messages");
  return removed;
}

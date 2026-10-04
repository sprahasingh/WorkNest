import mongoose from "mongoose";
import { destroyUpload } from "../../lib/cloudinary.js";
import { Message } from "../../models/Message.js";

// The files of messages that are about to be removed for good. Deleting the
// messages alone would leave them in storage forever.
export async function destroyConversationFiles(
  conversationId: mongoose.Types.ObjectId,
): Promise<void> {
  const withFiles = await Message.find({
    conversationId,
    "attachments.0": { $exists: true },
  })
    .select("attachments")
    .lean();
  for (const message of withFiles) {
    for (const file of message.attachments) {
      void destroyUpload(file.publicId, file.resourceType);
    }
  }
}

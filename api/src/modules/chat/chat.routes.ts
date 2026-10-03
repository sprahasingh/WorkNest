import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  addMembersSchema,
  conversationIdParamsSchema,
  conversationMemberParamsSchema,
  createConversationSchema,
  editMessageSchema,
  listMessagesQuerySchema,
  messageIdParamsSchema,
  muteSchema,
  searchQuerySchema,
  reactSchema,
  renameConversationSchema,
  sendMessageSchema,
} from "./chat.schemas.js";
import {
  addMembersController,
  configController,
  createConversationController,
  deleteMessageController,
  editMessageController,
  getConversationController,
  listConversationsController,
  listMessagesController,
  markReadController,
  muteController,
  searchController,
  presenceController,
  reactController,
  removeMemberController,
  renameConversationController,
  sendMessageController,
  signUploadController,
} from "./chat.controller.js";

const chatRouter = Router({ mergeParams: true });

chatRouter.get("/config", configController);
chatRouter.get("/presence", presenceController);
chatRouter.post("/attachments/sign", signUploadController);

chatRouter.get("/conversations", listConversationsController);
chatRouter.post(
  "/conversations",
  validate({ body: createConversationSchema }),
  createConversationController,
);
chatRouter.get(
  "/conversations/:conversationId",
  validate({ params: conversationIdParamsSchema }),
  getConversationController,
);
chatRouter.patch(
  "/conversations/:conversationId",
  validate({
    params: conversationIdParamsSchema,
    body: renameConversationSchema,
  }),
  renameConversationController,
);
chatRouter.post(
  "/conversations/:conversationId/members",
  validate({ params: conversationIdParamsSchema, body: addMembersSchema }),
  addMembersController,
);
chatRouter.delete(
  "/conversations/:conversationId/members/:userId",
  validate({ params: conversationMemberParamsSchema }),
  removeMemberController,
);
chatRouter.get(
  "/conversations/:conversationId/messages",
  validate({
    params: conversationIdParamsSchema,
    query: listMessagesQuerySchema,
  }),
  listMessagesController,
);
chatRouter.post(
  "/conversations/:conversationId/messages",
  validate({ params: conversationIdParamsSchema, body: sendMessageSchema }),
  sendMessageController,
);
chatRouter.post(
  "/conversations/:conversationId/read",
  validate({ params: conversationIdParamsSchema }),
  markReadController,
);

chatRouter.put(
  "/conversations/:conversationId/mute",
  validate({ params: conversationIdParamsSchema, body: muteSchema }),
  muteController,
);
chatRouter.get(
  "/search",
  validate({ query: searchQuerySchema }),
  searchController,
);

chatRouter.patch(
  "/messages/:messageId",
  validate({ params: messageIdParamsSchema, body: editMessageSchema }),
  editMessageController,
);
chatRouter.delete(
  "/messages/:messageId",
  validate({ params: messageIdParamsSchema }),
  deleteMessageController,
);
chatRouter.post(
  "/messages/:messageId/reactions",
  validate({ params: messageIdParamsSchema, body: reactSchema }),
  reactController,
);

export { chatRouter };

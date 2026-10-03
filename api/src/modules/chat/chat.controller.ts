import type { Request, Response } from "express";
import {
  addConversationMembers,
  createConversation,
  deleteMessage,
  editMessage,
  getChatConfig,
  getConversation,
  listConversations,
  listMessages,
  listOnlineMembers,
  markConversationRead,
  removeConversationMember,
  searchMessages,
  setConversationMuted,
  renameConversation,
  sendMessage,
  signAttachmentUpload,
  toggleReaction,
} from "./chat.service.js";
import type {
  CreateConversationInput,
  ListMessagesQuery,
  SendMessageInput,
} from "./chat.schemas.js";

const params = (req: Request) =>
  req.validated!.params as Record<string, string>;
const body = <T>(req: Request) => req.validated!.body as T;

export async function listConversationsController(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await listConversations());
}

export async function createConversationController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await createConversation(body<CreateConversationInput>(req));
  res
    .status(result.created ? 201 : 200)
    .json({ conversation: result.conversation });
}

export async function getConversationController(
  req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await getConversation(params(req).conversationId));
}

export async function renameConversationController(
  req: Request,
  res: Response,
): Promise<void> {
  const { name } = body<{ name: string }>(req);
  res
    .status(200)
    .json(await renameConversation(params(req).conversationId, name));
}

export async function addMembersController(
  req: Request,
  res: Response,
): Promise<void> {
  const { userIds } = body<{ userIds: string[] }>(req);
  res
    .status(200)
    .json(await addConversationMembers(params(req).conversationId, userIds));
}

export async function removeMemberController(
  req: Request,
  res: Response,
): Promise<void> {
  const { conversationId, userId } = params(req);
  res.status(200).json(await removeConversationMember(conversationId, userId));
}

export async function listMessagesController(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.validated!.query as ListMessagesQuery;
  res.status(200).json(await listMessages(params(req).conversationId, query));
}

export async function sendMessageController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await sendMessage(
    params(req).conversationId,
    body<SendMessageInput>(req),
  );
  res.status(201).json(result);
}

export async function editMessageController(
  req: Request,
  res: Response,
): Promise<void> {
  const { text } = body<{ text: string }>(req);
  res.status(200).json(await editMessage(params(req).messageId, text));
}

export async function deleteMessageController(
  req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await deleteMessage(params(req).messageId));
}

export async function reactController(
  req: Request,
  res: Response,
): Promise<void> {
  const { emoji } = body<{ emoji: string }>(req);
  res.status(200).json(await toggleReaction(params(req).messageId, emoji));
}

export async function markReadController(
  req: Request,
  res: Response,
): Promise<void> {
  await markConversationRead(params(req).conversationId);
  res.status(204).send();
}

export async function presenceController(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await listOnlineMembers());
}

export function configController(_req: Request, res: Response): void {
  res.status(200).json(getChatConfig());
}

export function signUploadController(_req: Request, res: Response): void {
  res.status(200).json(signAttachmentUpload());
}

export async function muteController(
  req: Request,
  res: Response,
): Promise<void> {
  const { muted } = body<{ muted: boolean }>(req);
  res
    .status(200)
    .json(await setConversationMuted(params(req).conversationId, muted));
}

export async function searchController(
  req: Request,
  res: Response,
): Promise<void> {
  const { q } = req.validated!.query as { q: string };
  res.status(200).json(await searchMessages(q));
}

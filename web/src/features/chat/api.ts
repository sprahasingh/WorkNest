import axios from "axios";
import { apiClient } from "@/api/client";

export const EDIT_WINDOW_MS = 10 * 60 * 1000;
export const REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "😮",
  "😢",
  "🙏",
  "👀",
] as const;
export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ConversationMember {
  userId: string;
  name: string;
  email: string;
  lastReadAt: string;
}

export interface Conversation {
  id: string;
  type: "direct" | "group";
  name: string | null;
  createdBy: string;
  adminIds: string[];
  members: ConversationMember[];
  lastMessage: {
    senderId: string;
    text: string;
    hasAttachment: boolean;
    deleted: boolean;
    system: boolean;
  } | null;
  lastMessageAt: string;
  createdAt: string;
  unreadCount: number;
  mentionCount: number;
  muted: boolean;
}

export interface MessageAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
  isImage: boolean;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  kind: "user" | "system";
  senderId: string;
  text: string;
  mentions: string[];
  replyTo: {
    id: string;
    senderId: string | null;
    text: string;
    deleted: boolean;
  } | null;
  attachments: MessageAttachment[];
  reactions: Reaction[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface UploadedAttachment {
  url: string;
  publicId: string;
  resourceType: "image" | "video" | "raw";
  name: string;
  mimeType: string;
  size: number;
}

const base = (orgId: string) => `/orgs/${orgId}/chat`;

export async function listConversations(orgId: string) {
  const response = await apiClient.get<{
    conversations: Conversation[];
    unreadCount: number;
  }>(`${base(orgId)}/conversations`);
  return response.data;
}

export async function startDirectChat(orgId: string, userId: string) {
  const response = await apiClient.post<{ conversation: Conversation }>(
    `${base(orgId)}/conversations`,
    { type: "direct", userId },
  );
  return response.data.conversation;
}

export async function createGroup(
  orgId: string,
  input: { name: string; memberIds: string[] },
) {
  const response = await apiClient.post<{ conversation: Conversation }>(
    `${base(orgId)}/conversations`,
    { type: "group", ...input },
  );
  return response.data.conversation;
}

export async function renameGroup(
  orgId: string,
  conversationId: string,
  name: string,
) {
  await apiClient.patch(`${base(orgId)}/conversations/${conversationId}`, {
    name,
  });
}

export async function addGroupMembers(
  orgId: string,
  conversationId: string,
  userIds: string[],
) {
  await apiClient.post(
    `${base(orgId)}/conversations/${conversationId}/members`,
    { userIds },
  );
}

export async function removeGroupMember(
  orgId: string,
  conversationId: string,
  userId: string,
) {
  await apiClient.delete(
    `${base(orgId)}/conversations/${conversationId}/members/${userId}`,
  );
}

export async function listMessages(
  orgId: string,
  conversationId: string,
  before?: string,
) {
  const response = await apiClient.get<MessagePage>(
    `${base(orgId)}/conversations/${conversationId}/messages`,
    { params: { before } },
  );
  return response.data;
}

export async function sendMessage(
  orgId: string,
  conversationId: string,
  input: {
    text: string;
    replyToId?: string;
    mentionIds?: string[];
    attachments?: UploadedAttachment[];
  },
) {
  const response = await apiClient.post<{ message: ChatMessage }>(
    `${base(orgId)}/conversations/${conversationId}/messages`,
    input,
  );
  return response.data.message;
}

export async function editMessage(
  orgId: string,
  messageId: string,
  text: string,
) {
  const response = await apiClient.patch<{ message: ChatMessage }>(
    `${base(orgId)}/messages/${messageId}`,
    { text },
  );
  return response.data.message;
}

export async function deleteMessage(orgId: string, messageId: string) {
  const response = await apiClient.delete<{ message: ChatMessage }>(
    `${base(orgId)}/messages/${messageId}`,
  );
  return response.data.message;
}

export async function reactToMessage(
  orgId: string,
  messageId: string,
  emoji: string,
) {
  const response = await apiClient.post<{ message: ChatMessage }>(
    `${base(orgId)}/messages/${messageId}/reactions`,
    { emoji },
  );
  return response.data.message;
}

export async function markConversationRead(
  orgId: string,
  conversationId: string,
) {
  await apiClient.post(`${base(orgId)}/conversations/${conversationId}/read`);
}

export async function getChatConfig(orgId: string) {
  const response = await apiClient.get<{ attachments: boolean }>(
    `${base(orgId)}/config`,
  );
  return response.data;
}

export async function getPresence(orgId: string) {
  const response = await apiClient.get<{ onlineUserIds: string[] }>(
    `${base(orgId)}/presence`,
  );
  return response.data.onlineUserIds;
}

interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  type: string;
  signature: string;
  uploadUrl: string;
}

// Files go straight from the browser to Cloudinary using a signature from the
// API, so they never pass through the server.
export async function uploadAttachment(
  orgId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedAttachment> {
  const { data: sign } = await apiClient.post<UploadSignature>(
    `${base(orgId)}/attachments/sign`,
  );
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sign.apiKey);
  form.append("timestamp", String(sign.timestamp));
  form.append("folder", sign.folder);
  form.append("type", sign.type);
  form.append("signature", sign.signature);

  const { data } = await axios.post<{
    secure_url: string;
    public_id: string;
    resource_type: "image" | "video" | "raw";
  }>(sign.uploadUrl, form, {
    timeout: 120_000,
    onUploadProgress: (event) => {
      if (event.total) onProgress?.(event.loaded / event.total);
    },
  });

  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function setConversationMuted(
  orgId: string,
  conversationId: string,
  muted: boolean,
) {
  await apiClient.put(`${base(orgId)}/conversations/${conversationId}/mute`, {
    muted,
  });
}

export interface SearchResult {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export async function searchMessages(orgId: string, q: string) {
  const response = await apiClient.get<{ results: SearchResult[] }>(
    `${base(orgId)}/search`,
    { params: { q } },
  );
  return response.data.results;
}

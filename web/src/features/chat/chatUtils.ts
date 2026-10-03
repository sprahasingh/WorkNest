import type { Conversation } from "./api";

export function conversationTitle(
  conversation: Conversation,
  myId: string,
): string {
  if (conversation.type === "group") return conversation.name ?? "Group";
  const other = conversation.members.find((member) => member.userId !== myId);
  return other?.name ?? "Former member";
}

// The other person in a direct chat; null for groups.
export function directPartnerId(
  conversation: Conversation,
  myId: string,
): string | null {
  if (conversation.type !== "direct") return null;
  return (
    conversation.members.find((member) => member.userId !== myId)?.userId ??
    null
  );
}

export function lastMessagePreview(
  conversation: Conversation,
  myId: string,
): string {
  const last = conversation.lastMessage;
  if (!last) return "No messages yet";
  if (last.deleted) return "Message deleted";
  const body =
    last.text.trim() || (last.hasAttachment ? "Sent an attachment" : "");
  if (last.system) return body;
  if (last.senderId === myId) return `You: ${body}`;
  if (conversation.type === "group") {
    const sender = conversation.members.find((m) => m.userId === last.senderId);
    return `${sender?.name.split(" ")[0] ?? "Someone"}: ${body}`;
  }
  return body;
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: diffDays < 7 ? "long" : undefined,
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Short stamp for the conversation list.
export function listTimeLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86_400_000,
  );
  if (diffDays === 0) return timeLabel(iso);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const COMMON_EMOJIS = [
  "😀",
  "😂",
  "🙂",
  "😉",
  "😍",
  "🥰",
  "😎",
  "🤔",
  "😅",
  "😢",
  "😮",
  "🙌",
  "👍",
  "👎",
  "👏",
  "🙏",
  "💪",
  "🔥",
  "🎉",
  "✅",
  "❌",
  "⚡",
  "💡",
  "📌",
  "❤️",
  "💯",
  "👀",
  "🚀",
  "☕",
  "🍕",
  "🎯",
  "📎",
];

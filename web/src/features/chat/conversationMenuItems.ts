import type { Conversation } from "./api";
import type { MenuItem as BaseMenuItem } from "./ContextMenu";

export type ConversationAction =
  "mute" | "unmute" | "markRead" | "markUnread" | "details" | "delete";

export type MenuItem = BaseMenuItem<ConversationAction>;

// What can be done to a conversation, depending on its state.
export function menuItemsFor(
  conversation: Conversation,
  options: { includeMarkRead: boolean },
): MenuItem[] {
  const unread = conversation.unreadCount > 0;
  return [
    conversation.muted
      ? { action: "unmute", label: "Unmute" }
      : { action: "mute", label: "Mute" },
    ...(options.includeMarkRead
      ? [
          unread
            ? ({ action: "markRead", label: "Mark as read" } as MenuItem)
            : ({ action: "markUnread", label: "Mark as unread" } as MenuItem),
        ]
      : []),
    ...(conversation.type === "group"
      ? [{ action: "details", label: "Group details" } as MenuItem]
      : []),
    { action: "delete", label: "Delete conversation", danger: true },
  ];
}

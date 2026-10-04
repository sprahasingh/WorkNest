import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { inputControlStyles } from "@/components/ui/Field";
import type { Conversation } from "./api";
import { Avatar } from "@/components/ui/Avatar";
import { AlertSettings } from "./AlertSettings";
import { RetentionNote } from "./RetentionNote";
import { ContextMenu } from "./ContextMenu";
import { useLongPress } from "./useLongPress";
import { menuItemsFor, type ConversationAction } from "./conversationMenuItems";
import { useConversationActions, useMessageSearch } from "./queries";
import {
  conversationTitle,
  directPartnerId,
  lastMessagePreview,
  listTimeLabel,
} from "./chatUtils";

interface ConversationListProps {
  orgId: string;
  conversations: Conversation[] | undefined;
  isPending: boolean;
  isError: boolean;
  myId: string;
  activeId: string | null;
  online: Set<string> | undefined;
  onSelect: (conversationId: string) => void;
  onOpenMessage: (conversationId: string, messageId: string) => void;
  onOpenDetails: (conversationId: string) => void;
  onRequestDelete: (conversation: Conversation) => void;
  onNew: () => void;
}

// Shows the search words inside a snippet of the message.
function Snippet({ text, term }: { text: string; term: string }) {
  const lower = text.toLowerCase();
  const at = lower.indexOf(term.toLowerCase());
  if (at < 0) return <>{text.slice(0, 90)}</>;
  const start = Math.max(0, at - 30);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark className="rounded bg-amber-200 px-0.5 text-slate-900 dark:bg-amber-400/40 dark:text-amber-100">
        {text.slice(at, at + term.length)}
      </mark>
      {text.slice(at + term.length, at + term.length + 60)}
    </>
  );
}

export function ConversationList({
  orgId,
  conversations,
  isPending,
  isError,
  myId,
  activeId,
  online,
  onSelect,
  onOpenMessage,
  onOpenDetails,
  onRequestDelete,
  onNew,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const messageHits = useMessageSearch(orgId, debounced);
  const actions = useConversationActions(orgId);

  // The menu opens from a long press (phones), a right click, the keyboard's
  // menu key, or the "more" button on a row.
  const [menu, setMenu] = useState<{
    conversation: Conversation;
    x: number;
    y: number;
    touch: boolean;
  } | null>(null);
  const longPress = useLongPress<Conversation>((conversation, x, y, touch) =>
    setMenu({ conversation, x, y, touch }),
  );

  const runAction = (action: ConversationAction) => {
    const target = menu?.conversation;
    setMenu(null);
    if (!target) return;
    const fail = () => toast.error("Couldn't do that. Please try again.");
    switch (action) {
      case "mute":
      case "unmute":
        actions.setMuted.mutate(
          { id: target.id, muted: action === "mute" },
          {
            onSuccess: () =>
              toast.success(action === "mute" ? "Chat muted" : "Chat unmuted"),
            onError: fail,
          },
        );
        break;
      case "markRead":
        actions.markRead.mutate(target.id, { onError: fail });
        break;
      case "markUnread":
        actions.markUnread.mutate(target.id, { onError: fail });
        break;
      case "details":
        onOpenDetails(target.id);
        break;
      case "delete":
        onRequestDelete(target);
        break;
    }
  };
  const titles = useMemo(
    () =>
      new Map(
        (conversations ?? []).map((c) => [
          c.id,
          { title: conversationTitle(c, myId), isGroup: c.type === "group" },
        ]),
      ),
    [conversations, myId],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations ?? [];
    return (conversations ?? []).filter(
      (conversation) =>
        conversationTitle(conversation, myId).toLowerCase().includes(term) ||
        conversation.members.some((member) =>
          member.name.toLowerCase().includes(term),
        ),
    );
  }, [conversations, search, myId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Messages
        </h1>
        <div className="flex items-center gap-1">
          <AlertSettings />
          <Button size="sm" onClick={onNew}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </Button>
        </div>
      </div>

      <div className="px-4 pb-3">
        <label className="sr-only" htmlFor="conversation-search">
          Search conversations
        </label>
        <input
          id="conversation-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people, groups and messages"
          className={inputControlStyles}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {isPending && (
          <ul className="space-y-1 px-2" aria-label="Loading conversations">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="flex items-center gap-3 py-2.5">
                <span className="h-10 w-10 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-2/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <span className="block h-3 w-4/5 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {isError && (
          <p className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
            Couldn't load your conversations. Try again in a moment.
          </p>
        )}

        {!isPending && !isError && (conversations?.length ?? 0) === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              No conversations yet
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Message a teammate or start a group. Only the people in a chat can
              see it.
            </p>
            <Button className="mt-4" onClick={onNew}>
              Start a conversation
            </Button>
          </div>
        )}

        {!isPending &&
          (conversations?.length ?? 0) > 0 &&
          visible.length === 0 &&
          debounced.length < 2 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nothing matches "{search.trim()}".
            </p>
          )}

        <ul>
          {visible.map((conversation) => {
            const title = conversationTitle(conversation, myId);
            const partner = directPartnerId(conversation, myId);
            // A muted chat only shows a count when you've been mentioned.
            const unread = conversation.muted
              ? conversation.mentionCount
              : conversation.unreadCount;
            return (
              <li key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={(event) => {
                    // A long press already opened the menu; don't also open the chat.
                    if (longPress.wasLongPress()) {
                      event.preventDefault();
                      return;
                    }
                    onSelect(conversation.id);
                  }}
                  {...longPress.handlersFor(conversation)}
                  aria-current={
                    conversation.id === activeId ? "true" : undefined
                  }
                  className={cn(
                    "flex w-full select-none items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors [-webkit-touch-callout:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600",
                    conversation.id === activeId
                      ? "bg-teal-50 dark:bg-teal-900/20"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800",
                  )}
                >
                  <Avatar
                    name={title}
                    seed={partner ?? conversation.id}
                    group={conversation.type === "group"}
                    online={
                      partner ? (online?.has(partner) ?? false) : undefined
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm text-slate-900 dark:text-slate-100",
                          unread > 0 ? "font-semibold" : "font-medium",
                        )}
                      >
                        {title}
                      </span>
                      {conversation.muted && (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="ml-1 inline h-3.5 w-3.5 shrink-0 text-slate-400"
                          role="img"
                          aria-label="Muted"
                        >
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                          <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
                          <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
                          <path d="M18 8a6 6 0 0 0-9.33-5" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      )}
                      <span className="shrink-0 text-xs text-slate-400 md:group-focus-within:invisible md:group-hover:invisible">
                        {conversation.lastMessage
                          ? listTimeLabel(conversation.lastMessageAt)
                          : ""}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          unread > 0
                            ? "font-medium text-slate-700 dark:text-slate-200"
                            : "text-slate-500 dark:text-slate-400",
                        )}
                      >
                        {lastMessagePreview(conversation, myId)}
                      </span>
                      {unread > 0 && (
                        <span
                          aria-label={`${unread} unread`}
                          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 px-1.5 text-xs font-bold text-white"
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`More options for ${title}`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      conversation,
                      x: box.right - 208,
                      y: box.bottom + 4,
                      touch: false,
                    });
                  }}
                  className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-slate-800 focus-visible:flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 md:group-focus-within:flex md:group-hover:flex dark:bg-slate-800/90 dark:text-slate-300 dark:ring-slate-600"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>

        <ContextMenu
          title={menu ? conversationTitle(menu.conversation, myId) : ""}
          items={
            menu
              ? menuItemsFor(menu.conversation, { includeMarkRead: true })
              : []
          }
          anchor={menu ? { x: menu.x, y: menu.y, touch: menu.touch } : null}
          onSelect={runAction}
          onClose={() => setMenu(null)}
        />

        {debounced.length >= 2 && (
          <section aria-label="Matching messages" className="mb-2 mt-1">
            <h2 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Messages
            </h2>
            {messageHits.isPending && (
              <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
            )}
            {messageHits.isSuccess && messageHits.data.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-500">
                No messages contain "{debounced}".
              </p>
            )}
            <ul>
              {messageHits.data?.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMessage(hit.conversationId, hit.id)}
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                        {titles.get(hit.conversationId)?.title ??
                          "Conversation"}
                        {/* In a one to one chat the title already says who. */}
                        {(titles.get(hit.conversationId)?.isGroup ||
                          hit.senderId === myId) && (
                          <span className="font-normal text-slate-400">
                            {" · "}
                            {hit.senderId === myId ? "You" : hit.senderName}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0">
                        {listTimeLabel(hit.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">
                      <Snippet text={hit.text} term={debounced} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <RetentionNote orgId={orgId} />
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { useCreateMeeting } from "@/features/meetings/queries";
import { generateJitsiLink } from "@/features/meetings/meetingUtils";
import { useImageViewer } from "@/components/imageViewerContext";
import { ConversationMenu } from "./ConversationMenu";
import { menuItemsFor, type ConversationAction } from "./conversationMenuItems";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { parseApiError } from "@/lib/apiError";
import type { Member } from "@/features/members/api";
import type { ChatMessage, Conversation, UploadedAttachment } from "./api";
import { Avatar } from "@/components/ui/Avatar";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { conversationTitle, dayLabel, directPartnerId } from "./chatUtils";
import {
  flattenMessages,
  useChatMutations,
  useMessages,
  useSetMuted,
} from "./queries";
import { useChatRealtime } from "./realtimeContext";

const RUN_GAP_MS = 5 * 60 * 1000;
const STICK_THRESHOLD_PX = 120;

interface PendingMessage {
  tempId: string;
  text: string;
  mentionIds: string[];
  replyToId?: string;
  attachments: UploadedAttachment[];
  status: "sending" | "failed";
  createdAt: string;
}

type ListItem =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      message: ChatMessage;
      showSender: boolean;
      gapAbove: boolean;
    };

interface ThreadViewProps {
  orgId: string;
  conversation: Conversation;
  myId: string;
  orgMembers: Member[] | undefined;
  online: Set<string> | undefined;
  attachmentsEnabled: boolean;
  // A message to scroll to and flash, from a search result or a link.
  jumpToMessageId: string | null;
  onJumped: () => void;
  onBack: () => void;
  onOpenInfo: () => void;
  onRequestDelete: (conversation: Conversation) => void;
}

export function ThreadView({
  orgId,
  conversation,
  myId,
  orgMembers,
  online,
  attachmentsEnabled,
  jumpToMessageId,
  onJumped,
  onBack,
  onOpenInfo,
  onRequestDelete,
}: ThreadViewProps) {
  const conversationId = conversation.id;
  const { typing, sendTyping } = useChatRealtime();
  const messagesQuery = useMessages(orgId, conversationId);
  const { send, edit, remove, react, markRead } = useChatMutations(
    orgId,
    conversationId,
  );
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = messagesQuery;
  const setMuted = useSetMuted(orgId, conversationId);
  const createMeeting = useCreateMeeting(orgId);
  const { openImage } = useImageViewer();
  const [headerMenu, setHeaderMenu] = useState<{
    x: number;
    y: number;
    touch: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<{
    files: File[];
    nonce: number;
  } | null>(null);
  const messages = useMemo(
    () => flattenMessages(messagesQuery.data),
    [messagesQuery.data],
  );

  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastIdRef = useRef<string | null>(null);
  const loadedOnceRef = useRef(false);
  const olderHeightRef = useRef<number | null>(null);
  const markedRef = useRef<string | null>(null);

  const membersById = useMemo(
    () => new Map(conversation.members.map((m) => [m.userId, m])),
    [conversation.members],
  );
  const nameOf = useCallback(
    (userId: string) => membersById.get(userId)?.name ?? "Former member",
    [membersById],
  );

  // Edit buttons disappear on their own once the 10 minutes are up.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const title = conversationTitle(conversation, myId);
  const partnerId = directPartnerId(conversation, myId);
  const partnerOnline = partnerId ? (online?.has(partnerId) ?? false) : false;
  const partnerGone =
    partnerId !== null &&
    orgMembers !== undefined &&
    !orgMembers.some((member) => member.userId.id === partnerId);

  const typingNames = (typing[conversationId] ?? [])
    .filter((id) => id !== myId)
    .map((id) => nameOf(id).split(" ")[0]);

  // --- Scrolling ---------------------------------------------------------

  const scrollToBottom = useCallback((smooth: boolean) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const near =
      element.scrollHeight - element.scrollTop - element.clientHeight <
      STICK_THRESHOLD_PX;
    stickRef.current = near;
    setAtBottom(near);
    if (near) setUnseen(0);
  };

  const lastMessage = messages[messages.length - 1];
  const lastId = lastMessage?.id ?? null;

  useLayoutEffect(() => {
    if (messages.length === 0 && pending.length === 0) return;
    if (!loadedOnceRef.current) {
      loadedOnceRef.current = true;
      lastIdRef.current = lastId;
      scrollToBottom(false);
      return;
    }
    if (lastId !== lastIdRef.current) {
      const addedByMe = lastMessage?.senderId === myId;
      lastIdRef.current = lastId;
      if (stickRef.current || addedByMe) scrollToBottom(true);
      else setUnseen((count) => count + 1);
    }
  }, [
    lastId,
    lastMessage?.senderId,
    messages.length,
    pending.length,
    myId,
    scrollToBottom,
  ]);

  useLayoutEffect(() => {
    if (pending.length > 0) scrollToBottom(true);
  }, [pending.length, scrollToBottom]);

  // Keep the reader where they were after older messages load above.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && olderHeightRef.current !== null && !isFetchingNextPage) {
      element.scrollTop += element.scrollHeight - olderHeightRef.current;
      olderHeightRef.current = null;
    }
  }, [messages.length, isFetchingNextPage]);

  const loadOlder = () => {
    olderHeightRef.current = scrollRef.current?.scrollHeight ?? null;
    void fetchNextPage();
  };

  // --- Read state --------------------------------------------------------

  const unread = conversation.unreadCount;
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const { mutate: markConversationRead, isPending: markingRead } = markRead;
  useEffect(() => {
    if (!visible || unread === 0 || markingRead) return;
    const marker = `${lastId}:${unread}`;
    if (markedRef.current === marker) return;
    markedRef.current = marker;
    markConversationRead();
  }, [visible, unread, lastId, markingRead, markConversationRead]);

  // --- Jumping to a message ---------------------------------------------

  const { isSuccess: messagesLoaded } = messagesQuery;
  useEffect(() => {
    if (!jumpToMessageId || !messagesLoaded) return;
    const found = messages.some((m) => m.id === jumpToMessageId);
    if (found) {
      // Wait a frame so the row exists in the page before scrolling to it.
      const frame = requestAnimationFrame(() => {
        document
          .getElementById(`msg-${jumpToMessageId}`)
          ?.scrollIntoView({ block: "center" });
        setHighlightId(jumpToMessageId);
        window.setTimeout(() => setHighlightId(null), 2200);
        onJumped();
      });
      return () => cancelAnimationFrame(frame);
    }
    // Older than what's loaded: keep loading earlier pages until it turns up.
    if (hasNextPage) {
      if (!isFetchingNextPage) void fetchNextPage();
    } else {
      toast("That message is no longer available.");
      onJumped();
    }
  }, [
    jumpToMessageId,
    messagesLoaded,
    messages,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    onJumped,
  ]);

  // --- Starting a meeting from the chat ---------------------------------

  const handleMeetNow = () => {
    // Open the tab straight away, as browsers only allow that from a click.
    const tab = window.open("", "_blank");
    const url = generateJitsiLink();
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 60_000);
    createMeeting.mutate(
      {
        title: `Meeting with ${title}`,
        agenda: "",
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        joinUrl: url,
        location: "",
        attendeeIds: conversation.members
          .map((m) => m.userId)
          .filter((id) => id !== myId),
        projectId: null,
        taskId: null,
      },
      {
        onSuccess: () => {
          if (tab) tab.location.href = url;
          else toast.success("Meeting started", { description: url });
          send.mutate({ text: `📞 I started a meeting. Join here: ${url}` });
        },
        onError: (error) => {
          tab?.close();
          toast.error(parseApiError(error).message);
        },
      },
    );
  };

  // --- Actions -----------------------------------------------------------

  const dispatch = useCallback(
    (item: PendingMessage) => {
      send.mutate(
        {
          text: item.text,
          replyToId: item.replyToId,
          mentionIds: item.mentionIds,
          attachments: item.attachments,
        },
        {
          onSuccess: () =>
            setPending((current) =>
              current.filter((entry) => entry.tempId !== item.tempId),
            ),
          onError: (error) => {
            setPending((current) =>
              current.map((entry) =>
                entry.tempId === item.tempId
                  ? { ...entry, status: "failed" }
                  : entry,
              ),
            );
            toast.error(parseApiError(error).message);
          },
        },
      );
    },
    [send],
  );

  const handleSend = ({
    text,
    mentionIds,
    attachments,
  }: {
    text: string;
    mentionIds: string[];
    attachments: UploadedAttachment[];
  }) => {
    const item: PendingMessage = {
      tempId: `pending-${Date.now()}`,
      text,
      mentionIds,
      replyToId: replyTo?.id,
      attachments,
      status: "sending",
      createdAt: new Date().toISOString(),
    };
    setPending((current) => [...current, item]);
    setReplyTo(null);
    dispatch(item);
  };

  const retry = (item: PendingMessage) => {
    setPending((current) =>
      current.map((entry) =>
        entry.tempId === item.tempId ? { ...entry, status: "sending" } : entry,
      ),
    );
    dispatch({ ...item, status: "sending" });
  };

  const handleJumpTo = (messageId: string) => {
    const target = document.getElementById(`msg-${messageId}`);
    if (!target) {
      toast("That message is further up. Load earlier messages to see it.");
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId(null), 1600);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    remove.mutate(deleteTarget.id, {
      onError: (error) => toast.error(parseApiError(error).message),
    });
    setDeleteTarget(null);
  };

  const saveEdit = (message: ChatMessage, text: string) => {
    edit.mutate(
      { messageId: message.id, text },
      {
        onSuccess: () => setEditingId(null),
        onError: (error) => {
          toast.error(parseApiError(error).message);
          if (parseApiError(error).code === "EDIT_WINDOW_EXPIRED") {
            setEditingId(null);
          }
        },
      },
    );
  };

  const runHeaderAction = (action: ConversationAction) => {
    setHeaderMenu(null);
    if (action === "mute" || action === "unmute") {
      const muting = action === "mute";
      setMuted.mutate(muting, {
        onSuccess: () =>
          toast.success(muting ? "Chat muted" : "Chat unmuted", {
            description: muting
              ? "You'll only be alerted when someone mentions you."
              : undefined,
          }),
        onError: (error) => toast.error(parseApiError(error).message),
      });
    } else if (action === "details") {
      onOpenInfo();
    } else if (action === "delete") {
      onRequestDelete(conversation);
    }
  };

  // --- Rendering ---------------------------------------------------------

  const items = useMemo<ListItem[]>(() => {
    const result: ListItem[] = [];
    let previous: ChatMessage | null = null;
    for (const message of messages) {
      const day = new Date(message.createdAt).toDateString();
      if (!previous || new Date(previous.createdAt).toDateString() !== day) {
        result.push({
          kind: "day",
          key: `day-${day}`,
          label: dayLabel(message.createdAt),
        });
        previous = null;
      }
      const continuesRun =
        previous !== null &&
        previous.kind === "user" &&
        message.kind === "user" &&
        previous.senderId === message.senderId &&
        new Date(message.createdAt).getTime() -
          new Date(previous.createdAt).getTime() <
          RUN_GAP_MS;
      result.push({
        kind: "message",
        key: message.id,
        message,
        showSender:
          conversation.type === "group" &&
          message.kind === "user" &&
          message.senderId !== myId &&
          !continuesRun,
        gapAbove: !continuesRun,
      });
      previous = message;
    }
    return result;
  }, [messages, conversation.type, myId]);

  // "Seen" sits under the last message you sent.
  const lastMineId = [...messages]
    .reverse()
    .find((m) => m.senderId === myId && m.kind === "user" && !m.deletedAt)?.id;
  const seenLabelFor = (message: ChatMessage): string | null => {
    if (message.id !== lastMineId || pending.length > 0) return null;
    const readers = conversation.members.filter(
      (member) =>
        member.userId !== myId &&
        new Date(member.lastReadAt).getTime() >=
          new Date(message.createdAt).getTime(),
    );
    if (readers.length === 0) return "Delivered";
    if (conversation.type === "direct") return "Seen";
    return readers.length === conversation.members.length - 1
      ? "Seen by everyone"
      : `Seen by ${readers.map((r) => r.name.split(" ")[0]).join(", ")}`;
  };

  const replyingToInfo = replyTo
    ? {
        name: replyTo.senderId === myId ? "yourself" : nameOf(replyTo.senderId),
        text: replyTo.text || "Attachment",
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <Avatar
          name={title}
          seed={partnerId ?? conversation.id}
          group={conversation.type === "group"}
          online={partnerId ? partnerOnline : undefined}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </h2>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {typingNames.length > 0
              ? `${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing…`
              : conversation.type === "group"
                ? `${conversation.members.length} members`
                : partnerGone
                  ? "No longer in this organization"
                  : partnerOnline
                    ? "Online"
                    : "Offline"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleMeetNow}
          disabled={createMeeting.isPending || partnerGone}
          aria-label="Start a meeting with this chat"
          title="Meet now"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setHeaderMenu({
              x: box.right - 208,
              y: box.bottom + 4,
              touch: window.matchMedia("(pointer: coarse)").matches,
            });
          }}
          aria-haspopup="menu"
          aria-label="Chat options"
          title="Chat options"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>
      </header>

      <div
        className="relative min-h-0 flex-1"
        onDragEnter={(event) => {
          if (
            attachmentsEnabled &&
            event.dataTransfer.types.includes("Files")
          ) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          if (
            attachmentsEnabled &&
            event.dataTransfer.types.includes("Files")
          ) {
            event.preventDefault();
          }
        }}
        onDragLeave={(event) => {
          // Only when leaving the thread itself, not moving over a child.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          if (!attachmentsEnabled) return;
          event.preventDefault();
          setDragging(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) {
            setDropped({ files, nonce: Date.now() });
          }
        }}
      >
        {dragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-teal-500 bg-teal-50/90 text-sm font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100"
          >
            Drop files to attach them
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onClick={() => setSelectedId(null)}
          className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
          role="log"
          aria-live="polite"
          aria-label={`Messages with ${title}`}
        >
          {hasNextPage && (
            <div className="mb-4 text-center">
              <Button
                variant="secondary"
                size="sm"
                loading={isFetchingNextPage}
                onClick={loadOlder}
              >
                Load earlier messages
              </Button>
            </div>
          )}

          {messagesQuery.isPending && (
            <p className="py-10 text-center text-sm text-slate-500">
              Loading messages…
            </p>
          )}
          {messagesQuery.isError && (
            <p className="py-10 text-center text-sm text-red-600 dark:text-red-400">
              Couldn't load messages.{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => void messagesQuery.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {messagesQuery.isSuccess &&
            messages.length === 0 &&
            pending.length === 0 && (
              <div className="py-12 text-center">
                <Avatar
                  name={title}
                  seed={partnerId ?? conversation.id}
                  group={conversation.type === "group"}
                  size="lg"
                  className="mx-auto"
                />
                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {conversation.type === "group"
                    ? `This is the start of ${title}`
                    : `Say hello to ${title}`}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Only{" "}
                  {conversation.type === "group"
                    ? "people in this group"
                    : "you two"}{" "}
                  can see this conversation.
                </p>
              </div>
            )}

          <div className="space-y-0.5">
            {items.map((item) =>
              item.kind === "day" ? (
                <div key={item.key} className="flex justify-center py-2">
                  <span className="rounded-full bg-slate-200 px-3 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {item.label}
                  </span>
                </div>
              ) : item.message.kind === "system" ? (
                <p
                  key={item.key}
                  className="py-2 text-center text-xs text-slate-500 dark:text-slate-400"
                >
                  {item.message.text}
                </p>
              ) : (
                <div key={item.key} className={cn(item.gapAbove && "pt-2")}>
                  <MessageBubble
                    message={item.message}
                    mine={item.message.senderId === myId}
                    senderName={nameOf(item.message.senderId)}
                    showSender={item.showSender}
                    nameOf={nameOf}
                    myId={myId}
                    now={now}
                    selected={selectedId === item.message.id}
                    highlighted={highlightId === item.message.id}
                    editing={editingId === item.message.id}
                    seenLabel={seenLabelFor(item.message)}
                    onSelect={() =>
                      setSelectedId((current) =>
                        current === item.message.id ? null : item.message.id,
                      )
                    }
                    onReply={() => {
                      setReplyTo(item.message);
                      setSelectedId(null);
                    }}
                    onStartEdit={() => setEditingId(item.message.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(text) => saveEdit(item.message, text)}
                    onDelete={() => setDeleteTarget(item.message)}
                    onReact={(emoji) =>
                      react.mutate(
                        { messageId: item.message.id, emoji },
                        {
                          onError: (error) =>
                            toast.error(parseApiError(error).message),
                        },
                      )
                    }
                    onJumpTo={handleJumpTo}
                    onOpenImage={(image) =>
                      openImage({ src: image.url, alt: image.name })
                    }
                  />
                </div>
              ),
            )}

            {pending.map((item) => (
              <div key={item.tempId} className="pt-2">
                <MessageBubble
                  message={{
                    id: item.tempId,
                    conversationId,
                    kind: "user",
                    senderId: myId,
                    text: item.text,
                    mentions: item.mentionIds,
                    replyTo: null,
                    attachments: item.attachments.map((a) => ({
                      url: a.url,
                      name: a.name,
                      mimeType: a.mimeType,
                      size: a.size,
                      // Not viewable until the server has it, so a file chip.
                      isImage: false,
                    })),
                    reactions: [],
                    createdAt: item.createdAt,
                    editedAt: null,
                    deletedAt: null,
                  }}
                  mine
                  senderName="You"
                  showSender={false}
                  nameOf={nameOf}
                  myId={myId}
                  now={now}
                  selected={false}
                  highlighted={false}
                  editing={false}
                  status={item.status}
                  onSelect={() => undefined}
                  onReply={() => undefined}
                  onStartEdit={() => undefined}
                  onCancelEdit={() => undefined}
                  onSaveEdit={() => undefined}
                  onDelete={() => undefined}
                  onReact={() => undefined}
                  onRetry={() => retry(item)}
                  onJumpTo={() => undefined}
                  onOpenImage={() => undefined}
                />
              </div>
            ))}
          </div>

          {typingNames.length > 0 && (
            <p className="mt-3 flex items-center gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex gap-0.5" aria-hidden="true">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 motion-reduce:animate-none"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
              </span>
              {typingNames.join(", ")} {typingNames.length > 1 ? "are" : "is"}{" "}
              typing
            </p>
          )}
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom(true);
              setUnseen(0);
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {unseen > 0
              ? `${unseen} new message${unseen > 1 ? "s" : ""}`
              : "Jump to latest"}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      <Composer
        key={conversationId}
        orgId={orgId}
        conversationId={conversationId}
        mentionable={conversation.members
          .filter((member) => member.userId !== myId)
          .map((member) => ({ userId: member.userId, name: member.name }))}
        droppedFiles={dropped}
        attachmentsEnabled={attachmentsEnabled}
        disabledReason={
          partnerGone ? "This person is no longer in the organization." : null
        }
        replyingTo={replyingToInfo}
        onCancelReply={() => setReplyTo(null)}
        onTyping={() => sendTyping(conversationId)}
        onSend={handleSend}
      />

      <ConversationMenu
        title={title}
        items={menuItemsFor(conversation, { includeMarkRead: false })}
        anchor={headerMenu}
        onSelect={runHeaderAction}
        onClose={() => setHeaderMenu(null)}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this message?"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          It will be removed for everyone in the conversation. They'll see "This
          message was deleted" in its place.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

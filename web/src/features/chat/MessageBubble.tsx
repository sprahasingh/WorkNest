import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { EDIT_WINDOW_MS, REACTION_EMOJIS, type ChatMessage } from "./api";
import { formatBytes, timeLabel } from "./chatUtils";

const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names that were @mentioned are picked out of the plain text.
function withMentions(
  text: string,
  mine: boolean,
  mentions: { id: string; name: string }[],
  myId: string,
): ReactNode[] {
  if (mentions.length === 0) return [text];
  const pattern = new RegExp(
    `(@(?:${mentions.map((m) => escapeRegex(m.name)).join("|")}))`,
    "g",
  );
  return text.split(pattern).map((part, index) => {
    if (index % 2 === 0) return part;
    const person = mentions.find((m) => `@${m.name}` === part);
    const aboutMe = person?.id === myId;
    return (
      <span
        key={index}
        className={cn(
          "rounded px-1 font-semibold",
          mine
            ? "bg-white/25 text-white"
            : aboutMe
              ? "bg-amber-100 text-amber-900 dark:bg-amber-400/25 dark:text-amber-100"
              : "bg-teal-50 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
        )}
      >
        {part}
      </span>
    );
  });
}

function linkify(
  text: string,
  mine: boolean,
  mentions: { id: string; name: string }[],
  myId: string,
): ReactNode[] {
  return text.split(URL_PATTERN).map((part, index) => {
    if (index % 2 === 0) {
      return (
        <span key={index}>{withMentions(part, mine, mentions, myId)}</span>
      );
    }
    const trailing = part.match(/[.,;:!?)]+$/)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <span key={index}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "underline underline-offset-2",
            mine ? "text-white" : "text-teal-700 dark:text-teal-300",
          )}
        >
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}

function Icon({ d, className }: { d: string[]; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      {d.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

const ICONS = {
  smile: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
    "M8 14s1.5 2 4 2 4-2 4-2",
    "M9 9h.01",
    "M15 9h.01",
  ],
  reply: ["M9 17 4 12l5-5", "M20 18v-2a4 4 0 0 0-4-4H4"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
  trash: [
    "M3 6h18",
    "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    "M10 11v6",
    "M14 11v6",
    "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  ],
  copy: [
    "M9 9h11v11H9z",
    "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  ],
  file: [
    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z",
    "M14 3v5h5",
  ],
};

export interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  senderName: string;
  showSender: boolean;
  nameOf: (userId: string) => string;
  myId: string;
  now: number;
  selected: boolean;
  highlighted: boolean;
  editing: boolean;
  status?: "sending" | "failed";
  seenLabel?: string | null;
  onSelect: () => void;
  onReply: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onRetry?: () => void;
  onJumpTo: (messageId: string) => void;
  onOpenImage: (image: { url: string; name: string }) => void;
}

export function MessageBubble({
  message,
  mine,
  senderName,
  showSender,
  nameOf,
  myId,
  now,
  selected,
  highlighted,
  editing,
  status,
  seenLabel,
  onSelect,
  onReply,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReact,
  onRetry,
  onJumpTo,
  onOpenImage,
}: MessageBubbleProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const deleted = message.deletedAt !== null;
  const pending = status !== undefined;
  const editWindowLeft =
    EDIT_WINDOW_MS - (now - new Date(message.createdAt).getTime());
  const canEdit = mine && !deleted && !pending && editWindowLeft > 0;
  const showActions = !deleted && !pending && !editing;

  const toolbarButton =
    "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100";

  const copy = () => {
    void navigator.clipboard
      ?.writeText(message.text)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Couldn't copy"));
  };

  return (
    <div
      id={`msg-${message.id}`}
      className={cn("group flex flex-col", mine ? "items-end" : "items-start")}
    >
      {showSender && (
        <span className="mb-0.5 ml-3 text-xs font-medium text-slate-500 dark:text-slate-400">
          {senderName}
        </span>
      )}

      <div
        className={cn(
          "relative max-w-[85%] sm:max-w-[70%]",
          pending && "opacity-70",
        )}
      >
        {showActions && (
          <div
            className={cn(
              "absolute -top-4 z-10 hidden items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-md group-focus-within:flex group-hover:flex dark:border-slate-600 dark:bg-slate-800",
              mine ? "right-2" : "left-2",
              selected && "flex",
            )}
          >
            <button
              type="button"
              aria-label="Add reaction"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
              className={toolbarButton}
            >
              <Icon d={ICONS.smile} />
            </button>
            <button
              type="button"
              aria-label="Reply"
              onClick={onReply}
              className={toolbarButton}
            >
              <Icon d={ICONS.reply} />
            </button>
            {message.text && (
              <button
                type="button"
                aria-label="Copy text"
                onClick={copy}
                className={toolbarButton}
              >
                <Icon d={ICONS.copy} />
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                aria-label="Edit message"
                onClick={onStartEdit}
                className={toolbarButton}
              >
                <Icon d={ICONS.edit} />
              </button>
            )}
            {mine && (
              <button
                type="button"
                aria-label="Delete message"
                onClick={onDelete}
                className={cn(
                  toolbarButton,
                  "hover:!text-red-600 dark:hover:!text-red-400",
                )}
              >
                <Icon d={ICONS.trash} />
              </button>
            )}
          </div>
        )}

        {pickerOpen && showActions && (
          <div
            role="menu"
            aria-label="Choose a reaction"
            className={cn(
              "absolute -top-14 z-20 flex gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-800",
              mine ? "right-2" : "left-2",
            )}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                onClick={() => {
                  setPickerOpen(false);
                  onReact(emoji);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div
          onClick={(event) => {
            // Keep the list from clearing the selection this tap just made.
            event.stopPropagation();
            onSelect();
          }}
          className={cn(
            "rounded-2xl px-3 py-2 text-sm shadow-sm transition-shadow",
            mine
              ? "rounded-br-md bg-teal-600 text-white"
              : "rounded-bl-md border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
            highlighted && "ring-2 ring-amber-400",
            deleted && "bg-transparent italic text-slate-400 shadow-none",
            deleted && mine && "!bg-transparent",
            deleted &&
              "border border-dashed border-slate-300 !bg-transparent dark:border-slate-600",
          )}
        >
          {deleted ? (
            <span className="text-slate-400 dark:text-slate-500">
              This message was deleted
            </span>
          ) : (
            <>
              {message.replyTo && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onJumpTo(message.replyTo!.id);
                  }}
                  className={cn(
                    "mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-xs",
                    mine
                      ? "border-white/60 bg-white/15"
                      : "border-teal-500 bg-slate-100 dark:bg-slate-700/60",
                  )}
                >
                  <span className="block font-semibold">
                    {message.replyTo.senderId
                      ? message.replyTo.senderId === myId
                        ? "You"
                        : nameOf(message.replyTo.senderId)
                      : "Message"}
                  </span>
                  <span className="line-clamp-2 break-words opacity-90">
                    {message.replyTo.deleted
                      ? "Message deleted"
                      : message.replyTo.text}
                  </span>
                </button>
              )}

              {message.attachments.length > 0 && (
                <div className="mb-1 space-y-1.5">
                  {message.attachments.map((attachment) =>
                    attachment.isImage ? (
                      <button
                        key={attachment.url}
                        type="button"
                        aria-label={`View picture ${attachment.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenImage(attachment);
                        }}
                        className="block w-full cursor-zoom-in"
                      >
                        <img
                          src={attachment.url}
                          alt={attachment.name}
                          loading="lazy"
                          className="max-h-64 w-full rounded-lg object-cover"
                        />
                      </button>
                    ) : (
                      <a
                        key={attachment.url}
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-2.5 py-2",
                          mine
                            ? "bg-white/15 hover:bg-white/25"
                            : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700",
                        )}
                      >
                        <Icon d={ICONS.file} className="h-5 w-5 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {attachment.name}
                          </span>
                          <span className="block text-xs opacity-80">
                            {formatBytes(attachment.size)}
                          </span>
                        </span>
                      </a>
                    ),
                  )}
                </div>
              )}

              {editing ? (
                <div onClick={(event) => event.stopPropagation()}>
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") onCancelEdit();
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (draft.trim()) onSaveEdit(draft.trim());
                      }
                    }}
                    rows={Math.min(6, Math.max(2, draft.split("\n").length))}
                    aria-label="Edit message"
                    className="w-full resize-none rounded-lg border border-white/40 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-white/60 focus:outline focus:outline-2 focus:outline-white/60"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span className="opacity-80">
                      Enter to save · Esc to cancel
                    </span>
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="rounded-md px-2 py-1 hover:bg-white/15"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={
                          !draft.trim() || draft.trim() === message.text
                        }
                        onClick={() => onSaveEdit(draft.trim())}
                        className="rounded-md bg-white px-2 py-1 font-semibold text-teal-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </span>
                  </div>
                </div>
              ) : (
                message.text && (
                  <p className="whitespace-pre-wrap break-words">
                    {linkify(
                      message.text,
                      mine,
                      message.mentions.map((id) => ({ id, name: nameOf(id) })),
                      myId,
                    )}
                  </p>
                )
              )}
            </>
          )}

          {!editing && (
            <span
              className={cn(
                "mt-1 flex items-center justify-end gap-1.5 text-[11px]",
                mine && !deleted ? "text-white/80" : "text-slate-400",
              )}
            >
              {message.editedAt && !deleted && <span>edited</span>}
              <span>
                {status === "sending"
                  ? "Sending…"
                  : timeLabel(message.createdAt)}
              </span>
            </span>
          )}
        </div>

        {status === "failed" && (
          <p className="mt-1 text-right text-xs text-red-600 dark:text-red-400">
            Couldn't send.{" "}
            <button
              type="button"
              onClick={onRetry}
              className="font-semibold underline"
            >
              Try again
            </button>
          </p>
        )}

        {message.reactions.length > 0 && (
          <div
            className={cn(
              "-mt-1 flex flex-wrap gap-1 px-1",
              mine ? "justify-end" : "justify-start",
            )}
          >
            {message.reactions.map((reaction) => {
              const reacted = reaction.userIds.includes(myId);
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => onReact(reaction.emoji)}
                  aria-pressed={reacted}
                  title={reaction.userIds.map(nameOf).join(", ")}
                  className={cn(
                    "mt-2 flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-sm",
                    reacted
                      ? "border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
                  )}
                >
                  <span>{reaction.emoji}</span>
                  <span className="font-semibold tabular-nums">
                    {reaction.userIds.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {seenLabel && (
          <p className="mt-1 text-right text-[11px] text-slate-400">
            {seenLabel}
          </p>
        )}
      </div>
    </div>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { parseApiError } from "@/lib/apiError";
import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  uploadAttachment,
  type UploadedAttachment,
} from "./api";
import { COMMON_EMOJIS, formatBytes } from "./chatUtils";
import { registerSignOutHook } from "@/lib/signOutHooks";

// Unsent text survives switching to another conversation and back.
const drafts = new Map<string, string>();
registerSignOutHook(() => drafts.clear());

interface Upload {
  id: string;
  file: File;
  progress: number;
  status: "uploading" | "done" | "error";
  result?: UploadedAttachment;
  previewUrl: string | null;
}

export interface MentionableMember {
  userId: string;
  name: string;
}

interface ComposerProps {
  orgId: string;
  // People who can be @mentioned (everyone in the chat except you).
  mentionable: MentionableMember[];
  // Files dropped onto the conversation; a new nonce means a new drop.
  droppedFiles: { files: File[]; nonce: number } | null;
  conversationId: string;
  attachmentsEnabled: boolean;
  disabledReason: string | null;
  replyingTo: { name: string; text: string } | null;
  onCancelReply: () => void;
  onTyping: () => void;
  onSend: (input: {
    text: string;
    mentionIds: string[];
    attachments: UploadedAttachment[];
  }) => void;
}

export function Composer({
  orgId,
  mentionable,
  droppedFiles,
  conversationId,
  attachmentsEnabled,
  disabledReason,
  replyingTo,
  onCancelReply,
  onTyping,
  onSend,
}: ComposerProps) {
  const [text, setText] = useState(() => drafts.get(conversationId) ?? "");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [menuClosedFor, setMenuClosedFor] = useState<string | null>(null);
  const [mentioned, setMentioned] = useState<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadsRef = useRef<Upload[]>([]);
  const addFilesRef = useRef<(files: File[]) => void>(() => undefined);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  const lastDrop = useRef(0);
  useEffect(() => {
    if (!droppedFiles || droppedFiles.nonce === lastDrop.current) return;
    lastDrop.current = droppedFiles.nonce;
    addFilesRef.current(droppedFiles.files);
  }, [droppedFiles]);

  useEffect(
    () => () => {
      for (const upload of uploadsRef.current) {
        if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      }
    },
    [],
  );

  // Grow with the text, up to a few lines.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  const mentionMatch = useMemo(() => {
    const before = text.slice(0, caret);
    const found = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(before);
    return found
      ? { start: before.length - found[2].length - 1, query: found[2] }
      : null;
  }, [text, caret]);
  const suggestions = useMemo(() => {
    if (!mentionMatch || menuClosedFor === `${mentionMatch.start}`) return [];
    const query = mentionMatch.query.toLowerCase();
    return mentionable
      .filter((member) => member.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mentionMatch, mentionable, menuClosedFor]);
  const activeSuggestion = Math.min(
    highlight,
    Math.max(0, suggestions.length - 1),
  );

  const uploading = uploads.some((upload) => upload.status === "uploading");
  // A file that failed is never sent quietly without; retry or remove it.
  const hasFailed = uploads.some((upload) => upload.status === "error");
  const ready = uploads.filter((upload) => upload.status === "done");
  const canSend =
    !disabledReason &&
    !uploading &&
    !hasFailed &&
    (text.trim().length > 0 || ready.length > 0);

  const updateUpload = (id: string, patch: Partial<Upload>) =>
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id ? { ...upload, ...patch } : upload,
      ),
    );

  const startUpload = (id: string, file: File) => {
    updateUpload(id, { status: "uploading", progress: 0 });
    uploadAttachment(orgId, file, (progress) => updateUpload(id, { progress }))
      .then((result) =>
        updateUpload(id, { status: "done", progress: 1, result }),
      )
      .catch((error: unknown) => {
        updateUpload(id, { status: "error" });
        toast.error(`Couldn't upload ${file.name}`, {
          description: parseApiError(error).message,
        });
      });
  };

  const addFiles = (files: File[]) => {
    if (!attachmentsEnabled || files.length === 0) return;
    const room = MAX_ATTACHMENTS - uploads.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    for (const file of files.slice(0, room)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is over ${formatBytes(MAX_FILE_BYTES)}.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null;
      setUploads((current) => [
        ...current,
        { id, file, progress: 0, status: "uploading", previewUrl },
      ]);
      startUpload(id, file);
    }
  };

  useEffect(() => {
    addFilesRef.current = addFiles;
  });

  const pickMention = (member: MentionableMember) => {
    if (!mentionMatch) return;
    const before = text.slice(0, mentionMatch.start);
    const after = text.slice(caret);
    const inserted = `@${member.name} `;
    const next = before + inserted + after;
    setText(next);
    drafts.set(conversationId, next);
    setMentioned((current) => new Map(current).set(member.userId, member.name));
    setHighlight(0);
    const position = before.length + inserted.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  const removeUpload = (id: string) =>
    setUploads((current) => {
      const target = current.find((upload) => upload.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((upload) => upload.id !== id);
    });

  const submit = () => {
    if (!canSend) return;
    // Only people whose @name is still in the text are mentioned.
    const mentionIds = [...mentioned]
      .filter(([, name]) => text.includes(`@${name}`))
      .map(([id]) => id);
    onSend({
      text: text.trim(),
      mentionIds,
      attachments: ready.flatMap((upload) =>
        upload.result ? [upload.result] : [],
      ),
    });
    for (const upload of uploads) {
      if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    }
    setUploads([]);
    setMentioned(new Map());
    setText("");
    drafts.delete(conversationId);
    setEmojiOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight(
          (activeSuggestion + step + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickMention(suggestions[activeSuggestion]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (mentionMatch) setMenuClosedFor(`${mentionMatch.start}`);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0 && attachmentsEnabled) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    drafts.set(conversationId, next);
    requestAnimationFrame(() => {
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  if (disabledReason) {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        {disabledReason}
      </div>
    );
  }

  const iconButton =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";

  return (
    <div className="relative border-t border-slate-200 bg-white px-3 pb-3 pt-2 dark:border-slate-800 dark:bg-slate-900">
      {replyingTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-teal-500 bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-700 dark:text-slate-200">
              Replying to {replyingTo.name}
            </p>
            <p className="truncate text-slate-500 dark:text-slate-400">
              {replyingTo.text}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {uploads.map((upload) => (
            <li
              key={upload.id}
              className="relative flex max-w-[15rem] items-center gap-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-8 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              {upload.previewUrl ? (
                <img
                  src={upload.previewUrl}
                  alt=""
                  className="h-9 w-9 rounded object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded bg-slate-200 text-slate-500 dark:bg-slate-700">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 3v5h5" />
                  </svg>
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-700 dark:text-slate-200">
                  {upload.file.name}
                </span>
                <span
                  className={cn(
                    "block",
                    upload.status === "error"
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-500 dark:text-slate-400",
                  )}
                >
                  {upload.status === "uploading"
                    ? `Uploading ${Math.round(upload.progress * 100)}%`
                    : upload.status === "error"
                      ? "Failed to upload"
                      : formatBytes(upload.file.size)}
                </span>
                {upload.status === "error" && (
                  <button
                    type="button"
                    onClick={() => startUpload(upload.id, upload.file)}
                    className="mt-0.5 font-medium text-teal-700 underline dark:text-teal-400"
                  >
                    Try again
                  </button>
                )}
              </span>
              {upload.status === "uploading" && (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-500"
                  style={{ width: `${upload.progress * 100}%` }}
                />
              )}
              <button
                type="button"
                onClick={() => removeUpload(upload.id)}
                aria-label={`Remove ${upload.file.name}`}
                className="absolute right-1 top-1 rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <ul
          id="mention-list"
          role="listbox"
          aria-label="People to mention"
          className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          {suggestions.map((member, index) => (
            <li
              key={member.userId}
              id={`mention-${member.userId}`}
              role="option"
              aria-selected={index === activeSuggestion}
              // mousedown keeps the textarea focused while choosing.
              onMouseDown={(event) => {
                event.preventDefault();
                pickMention(member);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200",
                index === activeSuggestion && "bg-teal-50 dark:bg-teal-900/30",
              )}
            >
              <span className="font-medium">{member.name}</span>
            </li>
          ))}
        </ul>
      )}

      {emojiOpen && (
        <div
          role="menu"
          aria-label="Insert emoji"
          // Keeps the textarea focused so the phone keyboard stays put.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute bottom-full left-3 z-20 mb-2 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => insertEmoji(emoji)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {attachmentsEnabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              className={iconButton}
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
                <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
              </svg>
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="Insert emoji"
          aria-expanded={emojiOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setEmojiOpen((open) => !open)}
          className={iconButton}
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
            <circle cx="12" cy="12" r="9" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <path d="M9 9h.01M15 9h.01" />
          </svg>
        </button>

        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          Message
        </label>
        <textarea
          id={`composer-${conversationId}`}
          ref={textareaRef}
          value={text}
          rows={1}
          maxLength={4000}
          placeholder="Write a message"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
            setHighlight(0);
            drafts.set(conversationId, event.target.value);
            if (event.target.value) onTyping();
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          aria-autocomplete="list"
          aria-controls={suggestions.length > 0 ? "mention-list" : undefined}
          aria-activedescendant={
            suggestions.length > 0
              ? `mention-${suggestions[activeSuggestion].userId}`
              : undefined
          }
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-500 dark:hover:bg-teal-400"
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
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 hidden px-1 text-[11px] text-slate-500 dark:text-slate-400 sm:block">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}

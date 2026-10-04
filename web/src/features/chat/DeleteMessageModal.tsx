import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { DELETE_WINDOW_MS, type ChatMessage } from "./api";

interface DeleteMessageModalProps {
  // The message being deleted; null keeps the dialog closed.
  message: ChatMessage | null;
  mine: boolean;
  now: number;
  onClose: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
}

const option =
  "block w-full rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:border-slate-600 dark:hover:bg-slate-700/50";

// Two ways to delete one message. "For me" hides it from you and works on
// any message. "For everyone" is only for the sender, for 30 minutes after
// sending, and leaves a note that the message was deleted.
export function DeleteMessageModal({
  message,
  mine,
  now,
  onClose,
  onDeleteForMe,
  onDeleteForEveryone,
}: DeleteMessageModalProps) {
  const left = message
    ? DELETE_WINDOW_MS - (now - new Date(message.createdAt).getTime())
    : 0;
  const canEveryone =
    mine && message !== null && message.deletedAt === null && left > 0;
  const minutesLeft = Math.min(30, Math.max(1, Math.ceil(left / 60000)));

  return (
    <Modal open={message !== null} onClose={onClose} title="Delete message?">
      <div className="space-y-2">
        {canEveryone && (
          <button
            type="button"
            onClick={onDeleteForEveryone}
            className={option}
          >
            <span className="block text-sm font-medium text-red-600 dark:text-red-400">
              Delete for everyone
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              Everyone sees that you deleted it. You can do this for{" "}
              {minutesLeft} more {minutesLeft === 1 ? "minute" : "minutes"}.
            </span>
          </button>
        )}
        <button type="button" onClick={onDeleteForMe} className={option}>
          <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
            Delete for me
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            Removes it from your view only. Other people can still see it.
          </span>
        </button>
      </div>
      {mine && !canEveryone && message?.deletedAt === null && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          This was sent more than 30 minutes ago, so it can only be deleted for
          you.
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

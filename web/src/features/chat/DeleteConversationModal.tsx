import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import type { Conversation } from "./api";

export type DeleteChoice = "clear" | "leave";

interface DeleteConversationModalProps {
  conversation: Conversation | null;
  title: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (choice: DeleteChoice) => void;
}

export function DeleteConversationModal(props: DeleteConversationModalProps) {
  return (
    <Modal
      open={props.conversation !== null}
      onClose={props.onClose}
      title="Delete conversation?"
    >
      {props.conversation && (
        <Body {...props} conversation={props.conversation} />
      )}
    </Modal>
  );
}

function Body({
  conversation,
  title,
  pending,
  onClose,
  onConfirm,
}: DeleteConversationModalProps & { conversation: Conversation }) {
  const [choice, setChoice] = useState<DeleteChoice>("clear");
  const isGroup = conversation.type === "group";

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {isGroup
          ? `This clears "${title}" from your list and hides its messages from you.`
          : `This removes your chat with ${title} from your list and hides its messages from you.`}{" "}
        {isGroup
          ? "Everyone else keeps the group and its history."
          : `${title} keeps their copy. If either of you writes again, the chat comes back with only the new messages.`}
      </p>

      {isGroup && (
        <fieldset className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <legend className="sr-only">What to do with the group</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="delete-choice"
              checked={choice === "clear"}
              onChange={() => setChoice("clear")}
              className="mt-1 accent-teal-600"
            />
            <span>
              Clear it for me
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                You stay in the group. New messages bring it back.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="delete-choice"
              checked={choice === "leave"}
              onChange={() => setChoice("leave")}
              className="mt-1 accent-teal-600"
            />
            <span>
              Leave the group
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                You stop receiving messages. Someone has to add you back to
                rejoin.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={pending}
          onClick={() => onConfirm(isGroup ? choice : "clear")}
        >
          {isGroup && choice === "leave" ? "Leave group" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

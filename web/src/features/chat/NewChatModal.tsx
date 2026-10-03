import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputStyles } from "@/components/ui/Field";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { parseApiError } from "@/lib/apiError";
import type { Member } from "@/features/members/api";
import { MemberPicker } from "@/components/MemberPicker";
import { useCreateGroup, useStartDirectChat } from "./queries";

type Mode = "direct" | "group";

interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  myId: string;
  members: Member[] | undefined;
  membersPending: boolean;
  online: Set<string> | undefined;
  onOpened: (conversationId: string) => void;
}

export function NewChatModal(props: NewChatModalProps) {
  // Closing unmounts the body, so every visit starts fresh.
  return (
    <Modal open={props.open} onClose={props.onClose} title="New conversation">
      <NewChatBody {...props} />
    </Modal>
  );
}

function NewChatBody({
  onClose,
  orgId,
  myId,
  members,
  membersPending,
  online,
  onOpened,
}: NewChatModalProps) {
  const [mode, setMode] = useState<Mode>("direct");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const startDirect = useStartDirectChat(orgId);
  const createGroup = useCreateGroup(orgId);

  const fail = (error: unknown) => toast.error(parseApiError(error).message);

  const openDirect = (userId: string) =>
    startDirect.mutate(userId, {
      onSuccess: (conversation) => {
        onOpened(conversation.id);
        onClose();
      },
      onError: fail,
    });

  const toggle = (userId: string) =>
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );

  const submitGroup = () =>
    createGroup.mutate(
      { name: name.trim(), memberIds: selected },
      {
        onSuccess: (conversation) => {
          onOpened(conversation.id);
          onClose();
        },
        onError: fail,
      },
    );

  const nameById = new Map(
    (members ?? []).map((member) => [member.userId.id, member.userId.name]),
  );

  return (
    <div className="space-y-4">
      <ViewTabs
        label="Conversation type"
        value={mode}
        onChange={setMode}
        tabs={[
          { value: "direct", label: "Direct message" },
          { value: "group", label: "New group" },
        ]}
      />

      {mode === "group" && (
        <Field label="Group name" htmlFor="group-name">
          <input
            id="group-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Launch team"
            className={inputStyles}
          />
        </Field>
      )}

      {mode === "group" && selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Remove ${nameById.get(id) ?? "person"}`}
                className="flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:bg-teal-900/40 dark:text-teal-200"
              >
                {nameById.get(id) ?? "Former member"}
                <span aria-hidden="true" className="text-sm leading-none">
                  ×
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <MemberPicker
        members={members}
        isPending={membersPending}
        excludeIds={[myId]}
        selectedIds={selected}
        multiple={mode === "group"}
        online={online}
        onToggle={mode === "direct" ? openDirect : toggle}
      />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {mode === "direct"
          ? "Pick someone to message. Only the two of you can see it, including admins."
          : "Group chats are only visible to the people in them."}
      </p>

      {mode === "group" && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submitGroup}
            loading={createGroup.isPending}
            disabled={!name.trim() || selected.length === 0}
          >
            Create group
          </Button>
        </div>
      )}
    </div>
  );
}

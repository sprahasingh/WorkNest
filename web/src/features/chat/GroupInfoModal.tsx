import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputStyles } from "@/components/ui/Field";
import { parseApiError } from "@/lib/apiError";
import type { Member } from "@/features/members/api";
import type { Conversation } from "./api";
import { Avatar } from "@/components/ui/Avatar";
import { MemberPicker } from "@/components/MemberPicker";
import { useGroupMutations } from "./queries";

interface GroupInfoModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  myId: string;
  conversation: Conversation;
  orgMembers: Member[] | undefined;
  membersPending: boolean;
  online: Set<string> | undefined;
  onLeft: () => void;
}

export function GroupInfoModal(props: GroupInfoModalProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Group details">
      <GroupInfoBody {...props} />
    </Modal>
  );
}

function GroupInfoBody({
  onClose,
  orgId,
  myId,
  conversation,
  orgMembers,
  membersPending,
  online,
  onLeft,
}: GroupInfoModalProps) {
  const isAdmin = conversation.adminIds.includes(myId);
  const [name, setName] = useState(conversation.name ?? "");
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { rename, addMembers, removeMember } = useGroupMutations(
    orgId,
    conversation.id,
  );

  const fail = (error: unknown) => toast.error(parseApiError(error).message);

  return (
    <div className="space-y-5">
      {isAdmin ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name.trim() !== conversation.name) {
              rename.mutate(name.trim(), {
                onSuccess: () => toast.success("Group renamed"),
                onError: fail,
              });
            }
          }}
        >
          <div className="flex-1">
            <Field label="Group name" htmlFor="rename-group">
              <input
                id="rename-group"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                className={inputStyles}
              />
            </Field>
          </div>
          <Button
            type="submit"
            variant="secondary"
            loading={rename.isPending}
            disabled={!name.trim() || name.trim() === conversation.name}
          >
            Save
          </Button>
        </form>
      ) : (
        <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
          {conversation.name}
        </p>
      )}

      <section aria-labelledby="group-members-heading">
        <div className="flex items-center justify-between">
          <h3
            id="group-members-heading"
            className="text-sm font-semibold text-slate-700 dark:text-slate-200"
          >
            {conversation.members.length} members
          </h3>
          {isAdmin && !adding && (
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              Add people
            </Button>
          )}
        </div>

        {adding && (
          <div className="mt-3 space-y-3">
            <MemberPicker
              members={orgMembers}
              isPending={membersPending}
              excludeIds={conversation.members.map((m) => m.userId)}
              selectedIds={toAdd}
              multiple
              online={online}
              onToggle={(userId) =>
                setToAdd((current) =>
                  current.includes(userId)
                    ? current.filter((id) => id !== userId)
                    : [...current, userId],
                )
              }
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setToAdd([]);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                loading={addMembers.isPending}
                disabled={toAdd.length === 0}
                onClick={() =>
                  addMembers.mutate(toAdd, {
                    onSuccess: () => {
                      setAdding(false);
                      setToAdd([]);
                    },
                    onError: fail,
                  })
                }
              >
                Add {toAdd.length > 0 ? toAdd.length : ""}
              </Button>
            </div>
          </div>
        )}

        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
          {conversation.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 py-2">
              <Avatar
                name={member.name}
                seed={member.userId}
                size="sm"
                online={online?.has(member.userId) ?? false}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {member.name}
                  {member.userId === myId && (
                    <span className="ml-1 text-slate-400">(you)</span>
                  )}
                </span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                  {member.email}
                </span>
              </span>
              {conversation.adminIds.includes(member.userId) && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  Admin
                </span>
              )}
              {isAdmin && member.userId !== myId && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${member.name}`}
                  disabled={removeMember.isPending}
                  onClick={() =>
                    removeMember.mutate(member.userId, { onError: fail })
                  }
                  className="text-red-600! dark:text-red-400!"
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
        {confirmLeave ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Leave this group? You won't see its messages any more unless
              someone adds you back.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmLeave(false)}
              >
                Stay
              </Button>
              <Button
                variant="danger"
                loading={removeMember.isPending}
                onClick={() =>
                  removeMember.mutate(myId, {
                    onSuccess: () => {
                      onClose();
                      onLeft();
                    },
                    onError: fail,
                  })
                }
              >
                Leave group
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="text-red-600! dark:text-red-400!"
            onClick={() => setConfirmLeave(true)}
          >
            Leave group
          </Button>
        )}
      </div>
    </div>
  );
}

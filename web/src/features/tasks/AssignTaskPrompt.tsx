import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import type { Member } from "@/features/members/api";
import type { Task } from "./api";

interface AssignTaskPromptProps {
  task: Task | null;
  members: Member[];
  pending: boolean;
  error: string | null;
  canAssign: boolean;
  onCancel: () => void;
  onMoveWithoutAssignee: () => void;
  onAssignAndMove: (assigneeIds: string[]) => void;
}

export function AssignTaskPrompt({
  task,
  members,
  pending,
  error,
  canAssign,
  onCancel,
  onMoveWithoutAssignee,
  onAssignAndMove,
}: AssignTaskPromptProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const eligibleMembers = members;
  return (
    <Modal
      open={task !== null}
      onClose={pending ? () => {} : onCancel}
      title="Assign this task?"
      contentClassName="max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This task has no assignee. Assign someone to make it clear who&apos;s
          responsible for the work.
        </p>
        {canAssign && (
          <fieldset disabled={pending}>
            <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Choose one or more assignees
            </legend>
            <div
              role="group"
              aria-label="Assignees"
              className="max-h-52 overflow-y-auto rounded-lg border border-slate-300 dark:border-slate-600"
            >
              {eligibleMembers.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  No eligible members available
                </p>
              ) : (
                eligibleMembers.map((member) => {
                  const id = member.userId.id;
                  return (
                    <label
                      key={member._id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(id)}
                        onChange={() =>
                          setSelected((current) =>
                            current.includes(id)
                              ? current.filter((item) => item !== id)
                              : [...current, id],
                          )
                        }
                        className="h-4 w-4 accent-teal-600"
                      />
                      <span className="text-slate-700 dark:text-slate-200">
                        {member.userId.name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </fieldset>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={onMoveWithoutAssignee}
            loading={pending}
          >
            Move without assignee
          </Button>
          {canAssign && (
            <Button
              onClick={() => onAssignAndMove(selected)}
              disabled={selected.length === 0 || pending}
              loading={pending}
              className="w-full"
            >
              Assign &amp; Move
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/cn";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import type { Member } from "@/features/members/api";
import type { CreateTaskInput, Task, UpdateTaskInput } from "./api";
import { ActivityFeed } from "./ActivityFeed";
import {
  useCreateActivity,
  useCreateTask,
  useDeleteTask,
  useUpdateTask,
} from "./queries";
import { useMarkReadWhenViewed } from "@/features/notifications/queries";

const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["low", "medium", "high"]),
  assigneeIds: z.array(z.string()),
  dueDate: z.string(),
  status: z.enum(["todo", "in_progress", "done"]),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

const TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "assigneeIds",
  "dueDate",
  "status",
] as const;

function toDateInputValue(dueDate: string | null): string {
  if (!dueDate) return "";
  return dueDate.slice(0, 10);
}

interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  projectId: string;
  members: Member[];
  task: Task | null;
  initialTab?: "details" | "activity";
}

export function TaskDrawer({
  open,
  onClose,
  orgId,
  projectId,
  members,
  task,
  initialTab = "details",
}: TaskDrawerProps) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const canAssign = useCan("task:assign");
  const canDelete = useCan("task:delete");
  const canUpdateAny = useCan("task:update:any");
  const canUpdateOwn = useCan("task:update:own");
  const canLead = useCan("task:request-update");
  const [formError, setFormError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);

  const createTask = useCreateTask(orgId, projectId);
  const updateTask = useUpdateTask(orgId, projectId);
  const deleteTask = useDeleteTask(orgId, projectId);
  const requestUpdate = useCreateActivity(orgId, {
    kind: "task",
    id: task?._id ?? "",
  });

  const isEditing = task !== null;
  useMarkReadWhenViewed(
    orgId,
    open && task ? { kind: "task", taskId: task._id } : null,
  );
  const isAssignee = task?.assigneeIds?.includes(userId) ?? false;
  const canEdit = !isEditing || canUpdateAny || (canUpdateOwn && isAssignee);
  const showDelete = isEditing && canDelete;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const phoneDeleteRef = useRef<HTMLDivElement>(null);

  // On phones the confirmation opens below the sticky buttons; bring it
  // into view so both choices can be tapped without scrolling.
  useEffect(() => {
    if (confirmingDelete) {
      phoneDeleteRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [confirmingDelete]);
  const showRequestUpdate = isEditing && canLead;

  const {
    register,
    handleSubmit,
    setError,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      priority: task?.priority ?? "medium",
      // Tasks created by someone who can't assign are always theirs.
      assigneeIds: task?.assigneeIds ?? (canAssign ? [] : [userId]),
      dueDate: toDateInputValue(task?.dueDate ?? null),
      status: task?.status ?? "todo",
    },
  });

  const selectedAssigneeIds = useWatch({ control, name: "assigneeIds" });

  const toggleAssignee = (memberId: string) => {
    setValue(
      "assigneeIds",
      selectedAssigneeIds.includes(memberId)
        ? selectedAssigneeIds.filter((id) => id !== memberId)
        : [...selectedAssigneeIds, memberId],
      { shouldDirty: true },
    );
  };

  const onSubmit = async (values: TaskFormValues) => {
    setFormError(null);
    try {
      if (isEditing) {
        const input: UpdateTaskInput = {
          title: values.title,
          description: values.description,
          priority: values.priority,
          status: values.status,
          dueDate: values.dueDate || null,
        };
        if (canAssign) {
          input.assigneeIds = values.assigneeIds;
        }
        await updateTask.mutateAsync({ taskId: task._id, input });
        toast.success("Task saved");
      } else {
        const input: CreateTaskInput = {
          title: values.title,
          description: values.description || undefined,
          priority: values.priority,
        };
        if (canAssign && values.assigneeIds.length > 0) {
          input.assigneeIds = values.assigneeIds;
        }
        if (values.dueDate) {
          input.dueDate = values.dueDate;
        }
        await createTask.mutateAsync(input);
        toast.success("Task created");
      }
      onClose();
    } catch (error) {
      const parsed = parseApiError(error);
      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }
      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        TASK_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    try {
      await deleteTask.mutateAsync(task._id);
      toast.success("Task deleted");
      onClose();
    } catch (error) {
      toast.error(parseApiError(error).message);
    }
  };

  const handleRequestUpdate = async () => {
    if (!task) return;
    if (!task.assigneeIds?.length) {
      toast.error("Assign someone to this task before requesting an update");
      return;
    }
    try {
      await requestUpdate.mutateAsync({ type: "update_request" });
      toast.success("Update requested from the assignees");
    } catch (error) {
      toast.error(parseApiError(error).message);
    }
  };

  const assigneeHint = canAssign
    ? "Pick one or more people."
    : isEditing
      ? "Only managers and admins can change who a task is assigned to."
      : "Tasks you create are assigned to you.";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? (canEdit ? "Edit task" : "Task details") : "New task"}
      size="lg"
    >
      {isEditing && (
        <div
          role="tablist"
          className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-700"
        >
          {(["details", "activity"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`-mb-px px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {tab === "details" ? "Details" : "Updates"}
            </button>
          ))}
        </div>
      )}

      {(!isEditing || activeTab === "details") && (
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          noValidate
          className="space-y-4"
        >
          <ErrorBanner message={formError} />

          {!canEdit && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              You can view this task, but only its assignees, managers and
              admins can edit it.
            </p>
          )}

          <fieldset disabled={!canEdit} className="space-y-4">
            <Field label="Title" htmlFor="title" error={errors.title?.message}>
              <input
                id="title"
                type="text"
                {...register("title")}
                className={inputStyles}
              />
            </Field>

            <Field label="Description" htmlFor="description">
              <textarea
                id="description"
                rows={3}
                {...register("description")}
                className={inputStyles}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Priority" htmlFor="priority">
                <select
                  id="priority"
                  {...register("priority")}
                  className={inputStyles}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>

              <Field label="Due date" htmlFor="dueDate">
                <input
                  id="dueDate"
                  type="date"
                  {...register("dueDate")}
                  className={inputStyles}
                />
              </Field>
            </div>

            <Field
              label="Assignees"
              hint={assigneeHint}
              error={errors.assigneeIds?.message}
            >
              <div
                role="group"
                aria-label="Assignees"
                className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
              >
                {members.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-400">
                    No members yet
                  </p>
                ) : (
                  members.map((member) => {
                    const memberId = member.userId.id;
                    const checked = selectedAssigneeIds.includes(memberId);
                    return (
                      <label
                        key={member._id}
                        className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                          canAssign && canEdit
                            ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/60"
                            : "cursor-not-allowed opacity-70"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canAssign}
                          onChange={() => toggleAssignee(memberId)}
                          className="h-4 w-4 rounded border-slate-300 accent-teal-600"
                        />
                        <span className="text-slate-700 dark:text-slate-200">
                          {member.userId.name}
                          {memberId === userId && (
                            <span className="text-slate-400"> (you)</span>
                          )}
                        </span>
                        <span className="ml-auto text-xs capitalize text-slate-400">
                          {member.role}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </Field>

            {isEditing && (
              <Field label="Status" htmlFor="status">
                <select
                  id="status"
                  {...register("status")}
                  className={inputStyles}
                >
                  <option value="todo">To do</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </Field>
            )}
          </fieldset>

          <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white pt-4 dark:border-slate-700 dark:bg-slate-800 sm:static sm:border-0 sm:bg-transparent sm:pt-2">
            {confirmingDelete && (
              <div
                role="alert"
                className="hidden items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30 sm:flex"
              >
                <p className="text-sm text-red-800 dark:text-red-200">
                  Delete this task? This can&apos;t be undone.
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep task
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => void handleDelete()}
                    disabled={deleteTask.isPending}
                    loading={deleteTask.isPending}
                  >
                    {deleteTask.isPending ? "Deleting…" : "Delete task"}
                  </Button>
                </div>
              </div>
            )}

            <div
              className={cn(
                "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3",
                confirmingDelete && "sm:hidden",
              )}
            >
              {showDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="hidden whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 sm:mr-auto sm:block"
                >
                  Delete task
                </button>
              )}
              <div
                className={cn(
                  "order-2 grid gap-2 sm:order-1 sm:flex sm:gap-3",
                  showRequestUpdate ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {showRequestUpdate && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleRequestUpdate()}
                    disabled={requestUpdate.isPending}
                    loading={requestUpdate.isPending}
                    className="whitespace-nowrap"
                  >
                    Request update
                  </Button>
                )}
                <Button
                  type="button"
                  variant={canEdit ? "ghost" : "secondary"}
                  onClick={onClose}
                  className="whitespace-nowrap border border-slate-300 dark:border-slate-600 sm:border-0"
                >
                  {canEdit ? "Cancel" : "Close"}
                </Button>
              </div>
              {canEdit && (
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  className="order-1 w-full whitespace-nowrap sm:order-2 sm:w-auto"
                >
                  {isSubmitting
                    ? "Saving…"
                    : isEditing
                      ? "Save changes"
                      : "Create task"}
                </Button>
              )}
            </div>
          </div>

          {showDelete && (
            <div
              ref={phoneDeleteRef}
              className="border-t border-slate-200 pt-3 dark:border-slate-700 sm:hidden"
            >
              {confirmingDelete ? (
                <div role="alert" className="space-y-2">
                  <p className="text-center text-sm text-red-800 dark:text-red-200">
                    Delete this task? This can&apos;t be undone.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep task
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void handleDelete()}
                      disabled={deleteTask.isPending}
                      loading={deleteTask.isPending}
                    >
                      {deleteTask.isPending ? "Deleting…" : "Delete task"}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="w-full rounded-lg py-2 text-center text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  Delete task
                </button>
              )}
            </div>
          )}
        </form>
      )}

      {isEditing && activeTab === "activity" && (
        <ActivityFeed
          orgId={orgId}
          scope={{ kind: "task", id: task._id }}
          canLead={canLead}
          canContribute={isAssignee}
        />
      )}
    </Modal>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { useCan } from "@/hooks/useCan";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import type { Member } from "@/features/members/api";
import type { CreateTaskInput, Task, UpdateTaskInput } from "./api";
import { useCreateTask, useDeleteTask, useUpdateTask } from "./queries";
import type { TaskFilters } from "./queries";

const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["low", "medium", "high"]),
  assigneeId: z.string(),
  dueDate: z.string(),
  status: z.enum(["todo", "in_progress", "done"]),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

const TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "assigneeId",
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
  filters: TaskFilters;
  members: Member[];
  task: Task | null;
}

export function TaskDrawer({
  open,
  onClose,
  orgId,
  projectId,
  filters,
  members,
  task,
}: TaskDrawerProps) {
  const canAssign = useCan("task:assign");
  const canDelete = useCan("task:delete");
  const [formError, setFormError] = useState<string | null>(null);

  const createTask = useCreateTask(orgId, projectId, filters);
  const updateTask = useUpdateTask(orgId, projectId);
  const deleteTask = useDeleteTask(orgId, projectId);

  const isEditing = task !== null;
  const assigneeSelectDisabled = isEditing && !canAssign;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      priority: task?.priority ?? "medium",
      assigneeId: task?.assigneeId ?? "",
      dueDate: toDateInputValue(task?.dueDate ?? null),
      status: task?.status ?? "todo",
    },
  });

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
          input.assigneeId = values.assigneeId || null;
        }
        await updateTask.mutateAsync({ taskId: task._id, input });
      } else {
        const input: CreateTaskInput = {
          title: values.title,
          description: values.description || undefined,
          priority: values.priority,
        };
        if (values.assigneeId) {
          input.assigneeId = values.assigneeId;
        }
        if (values.dueDate) {
          input.dueDate = values.dueDate;
        }
        await createTask.mutateAsync(input);
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
      onClose();
    } catch (error) {
      const parsed = parseApiError(error);
      toast.error(parsed.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit task" : "New task"}>
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
        className="space-y-4"
      >
        <ErrorBanner message={formError} />

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
          label="Assignee"
          htmlFor="assigneeId"
          hint={
            assigneeSelectDisabled
              ? "Only managers and admins can reassign tasks."
              : undefined
          }
        >
          <select
            id="assigneeId"
            disabled={assigneeSelectDisabled}
            {...register("assigneeId")}
            className={inputStyles}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member._id} value={member.userId.id}>
                {member.userId.name}
              </option>
            ))}
          </select>
        </Field>

        {isEditing && (
          <Field label="Status" htmlFor="status">
            <select id="status" {...register("status")} className={inputStyles}>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </Field>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div>
            {isEditing && canDelete && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="text-sm font-medium text-red-600 hover:underline"
              >
                Delete task
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : isEditing
                  ? "Save changes"
                  : "Create task"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

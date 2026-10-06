import type { Member } from "@/features/members/api";
import type { Task, TaskStatus } from "./api";
import { formatDateInTimeZone, formatDateTimeInTimeZone } from "@/lib/time";
import { MoreMenu, MoreMenuItem } from "@/components/ui/MoreMenu";
import type { TaskView } from "./api";

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  return new Date(task.dueDate) <= new Date();
}

interface TaskCardProps {
  task: Task;
  timeZone: string;
  members: Member[];
  canChangeStatus: boolean;
  onStatusChange: (task: Task, newStatus: TaskStatus) => void;
  onClick: () => void;
  view: TaskView;
  canEdit: boolean;
  canManage: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onDeletePermanently: () => void;
}

export function TaskCard({
  task,
  timeZone,
  members,
  canChangeStatus,
  onStatusChange,
  onClick,
  view,
  canEdit,
  canManage,
  onArchive,
  onUnarchive,
  onRestore,
  onDelete,
  onDeletePermanently,
}: TaskCardProps) {
  const assignees = members.filter((m) =>
    task.assigneeIds?.includes(m.userId.id),
  );
  const overdue = isOverdue(task);

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {task.title}
        </p>
        {assignees.length > 0 && (
          <div className="flex shrink-0 -space-x-1.5">
            {assignees.slice(0, 3).map((assignee) => (
              <span
                key={assignee._id}
                title={assignee.userId.name}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-medium text-white ring-1 ring-white dark:ring-slate-800"
              >
                {getInitials(assignee.userId.name)}
              </span>
            ))}
            {assignees.length > 3 && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-medium text-slate-700 ring-1 ring-white dark:bg-slate-600 dark:text-slate-200 dark:ring-slate-800">
                +{assignees.length - 3}
              </span>
            )}
          </div>
        )}
        {(canEdit || canManage) && (
          <div onClick={(event) => event.stopPropagation()}>
            <MoreMenu label={task.title}>
              {canEdit && view !== "bin" && (
                <MoreMenuItem onClick={onClick}>Edit</MoreMenuItem>
              )}
              {view === "active" && canManage && (
                <MoreMenuItem onClick={onArchive}>Archive</MoreMenuItem>
              )}
              {view === "completed" && canManage && (
                <MoreMenuItem onClick={onArchive}>Archive</MoreMenuItem>
              )}
              {view === "archived" && canManage && (
                <MoreMenuItem onClick={onUnarchive}>Unarchive</MoreMenuItem>
              )}
              {view === "bin" && canManage && (
                <MoreMenuItem onClick={onRestore}>Restore</MoreMenuItem>
              )}
              {view === "bin" && canManage && (
                <MoreMenuItem tone="danger" onClick={onDeletePermanently}>
                  Delete permanently
                </MoreMenuItem>
              )}
              {view !== "bin" && canManage && (
                <MoreMenuItem tone="danger" onClick={onDelete}>
                  Move to bin
                </MoreMenuItem>
              )}
            </MoreMenu>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[task.priority]}`}
        >
          {task.priority}
        </span>
        {view === "archived" && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {task.archivedReason === "plan_limit"
              ? "Force-archived"
              : "Manually archived"}
          </span>
        )}
        {task.dueDate && (
          <span
            className={`text-xs ${overdue ? "font-medium text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}
          >
            {task.dueDateIsDateOnly === false
              ? formatDateTimeInTimeZone(task.dueDate, timeZone)
              : formatDateInTimeZone(task.dueDate, timeZone)}
          </span>
        )}
      </div>

      {canChangeStatus && task.status !== "done" && (
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const newStatus = event.target.value as TaskStatus;
            if (newStatus !== task.status) {
              onStatusChange(task, newStatus);
            }
          }}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {task.status === "done" && task.completedAt && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          Completed {new Date(task.completedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

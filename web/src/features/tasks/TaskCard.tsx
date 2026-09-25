import type { Member } from "@/features/members/api";
import type { Task, TaskStatus } from "./api";

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
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
  return new Date(task.dueDate) < new Date();
}

interface TaskCardProps {
  task: Task;
  members: Member[];
  canChangeStatus: boolean;
  onStatusChange: (task: Task, newStatus: TaskStatus) => void;
  onClick: () => void;
}

export function TaskCard({
  task,
  members,
  canChangeStatus,
  onStatusChange,
  onClick,
}: TaskCardProps) {
  const assignee = members.find((m) => m.userId.id === task.assigneeId);
  const overdue = isOverdue(task);

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg bg-white p-3 shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">{task.title}</p>
        {assignee && (
          <span
            title={assignee.userId.name}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-medium text-white"
          >
            {getInitials(assignee.userId.name)}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[task.priority]}`}
        >
          {task.priority}
        </span>
        {task.dueDate && (
          <span
            className={`text-xs ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}
          >
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {canChangeStatus && (
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const newStatus = event.target.value as TaskStatus;
            if (newStatus !== task.status) {
              onStatusChange(task, newStatus);
            }
          }}
          className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

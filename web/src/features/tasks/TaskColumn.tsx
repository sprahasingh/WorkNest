import type { Member } from "@/features/members/api";
import { TaskCard } from "./TaskCard";
import { useTaskColumn, type TaskFilters } from "./queries";
import type { Task, TaskStatus } from "./api";

const COLUMN_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

interface TaskColumnProps {
  orgId: string;
  projectId: string;
  status: TaskStatus;
  filters: TaskFilters;
  members: Member[];
  canChangeStatus: (task: Task) => boolean;
  onStatusChange: (task: Task, newStatus: TaskStatus) => void;
  onTaskClick: (task: Task) => void;
}

export function TaskColumn({
  orgId,
  projectId,
  status,
  filters,
  members,
  canChangeStatus,
  onStatusChange,
  onTaskClick,
}: TaskColumnProps) {
  const {
    data,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTaskColumn(orgId, projectId, status, filters);

  const tasks = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex min-w-72 flex-1 flex-col rounded-lg bg-slate-50 p-3">
      <h2 className="text-sm font-semibold text-slate-700">
        {COLUMN_LABELS[status]}{" "}
        <span className="font-normal text-slate-400">({tasks.length})</span>
      </h2>

      <div className="mt-3 space-y-2">
        {isPending &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-slate-200"
            />
          ))}

        {isError && (
          <p className="text-sm text-red-600">Couldn&apos;t load tasks.</p>
        )}

        {!isPending &&
          !isError &&
          tasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              members={members}
              canChangeStatus={canChangeStatus(task)}
              onStatusChange={onStatusChange}
              onClick={() => onTaskClick(task)}
            />
          ))}

        {!isPending && !isError && tasks.length === 0 && (
          <p className="text-sm text-slate-400">No tasks.</p>
        )}

        {hasNextPage && (
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full rounded border border-slate-200 py-1.5 text-xs font-medium text-slate-500 disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

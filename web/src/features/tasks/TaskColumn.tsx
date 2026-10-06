import type { Member } from "@/features/members/api";
import { Button } from "@/components/ui/Button";
import { TaskCard } from "./TaskCard";
import { useTaskColumn, type TaskFilters } from "./queries";
import type { Task, TaskStatus, TaskView } from "./api";
import { useOrgDetails } from "@/features/org/queries";

const COLUMN_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

interface TaskColumnProps {
  orgId: string;
  projectId: string;
  view: TaskView;
  status: TaskStatus | undefined;
  filters: TaskFilters;
  members: Member[];
  canChangeStatus: (task: Task) => boolean;
  onStatusChange: (task: Task, newStatus: TaskStatus) => void;
  onTaskClick: (task: Task) => void;
  canEdit: (task: Task) => boolean;
  canManage: boolean;
  onArchive: (task: Task) => void;
  onUnarchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDeletePermanently: (task: Task) => void;
  onKeepArchived: (task: Task) => void;
}

export function TaskColumn({
  orgId,
  projectId,
  view,
  status,
  filters,
  members,
  canChangeStatus,
  onStatusChange,
  onTaskClick,
  canEdit,
  canManage,
  onArchive,
  onUnarchive,
  onRestore,
  onDelete,
  onDeletePermanently,
  onKeepArchived,
}: TaskColumnProps) {
  const { data: organization } = useOrgDetails(orgId);
  const {
    data,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTaskColumn(orgId, projectId, view, status, filters);

  const tasks = data?.pages.flatMap((page) => page.items) ?? [];
  const total = data?.pages[0]?.total ?? tasks.length;

  return (
    <div
      data-tour={
        view === "active" && status === "todo" ? "tasks-first-card" : undefined
      }
      className="flex w-[86vw] max-w-sm shrink-0 snap-start flex-col rounded-xl bg-slate-50 p-3 dark:bg-slate-900 md:w-72 md:max-w-none"
    >
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {status
          ? COLUMN_LABELS[status]
          : view === "archived"
            ? "Archived"
            : "Bin"}{" "}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          ({total})
        </span>
      </h2>

      <div className="mt-3 space-y-2">
        {isPending &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800"
            />
          ))}

        {isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load tasks.
          </p>
        )}

        {!isPending &&
          !isError &&
          tasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              timeZone={organization?.timeZone ?? "UTC"}
              members={members}
              canChangeStatus={view === "active" && canChangeStatus(task)}
              onStatusChange={onStatusChange}
              onClick={() => onTaskClick(task)}
              view={view}
              canEdit={canEdit(task)}
              canManage={canManage}
              onArchive={() => onArchive(task)}
              onUnarchive={() => onUnarchive(task)}
              onRestore={() => onRestore(task)}
              onDelete={() => onDelete(task)}
              onDeletePermanently={() => onDeletePermanently(task)}
              onKeepArchived={() => onKeepArchived(task)}
            />
          ))}

        {!isPending && !isError && tasks.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No tasks.
          </p>
        )}

        {hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}

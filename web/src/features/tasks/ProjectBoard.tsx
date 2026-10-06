import { useEffect, useRef, useState } from "react";
import {
  useAccountPaused,
  useGrowthBlocked,
  GROWTH_BLOCKED_HINT,
  PAUSED_HINT,
} from "@/features/billing/useAccountPaused";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { useMembers } from "@/features/members/queries";
import {
  useProject,
  useUnarchiveProject,
  useKeepPlanArchived,
} from "@/features/projects/queries";
import { parseApiError } from "@/lib/apiError";
import { NotFound } from "@/pages/NotFound";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/Modal";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { TaskColumn } from "./TaskColumn";
import { TaskDrawer } from "./TaskDrawer";
import { ActivityFeed } from "./ActivityFeed";
import { MuteToggle } from "@/features/notifications/MuteToggle";
import {
  useTask,
  useTaskStats,
  useTaskViewCounts,
  useUpdateTaskStatus,
  useArchiveTask,
  useUnarchiveTask,
  useRestoreTask,
  useDeleteTask,
  useDeleteTaskPermanently,
  type TaskFilters,
} from "./queries";
import { canChangeTaskStatus } from "./ownership";
import { useMarkReadWhenViewed } from "@/features/notifications/queries";
import { PLAN_NAMES } from "@/lib/plans";
import {
  defaultLifecycleSort,
  getLifecycleSortOptions,
  type LifecycleSort,
} from "@/lib/lifecycleSorting";
import type { Task, TaskStatus, TaskPriority, TaskView } from "./api";
import { taskViewAfterUnarchive } from "@/lib/planRestorePrompt";

const ACTIVE_STATUSES: TaskStatus[] = ["todo", "in_progress"];
const TASK_VIEWS: { value: TaskView; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "bin", label: "Bin" },
];

const selectStyles =
  "min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

type DrawerState =
  | { mode: "create" }
  | { mode: "edit"; task: Task; tab?: "details" | "activity" }
  | null;

export function ProjectBoard() {
  const { orgId, role } = useOrg();
  const paused = useAccountPaused();
  const growthBlocked = useGrowthBlocked();
  const { projectId } = useParams<{ projectId: string }>();
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canUpdateAny = useCan("task:update:any");
  const canUpdateOwn = useCan("task:update:own");
  const canCreate = useCan("task:create");
  const canLead = useCan("task:request-update");
  const canManageProject = useCan("project:write");
  const canManageTasks = useCan("task:delete");
  const canUpdateOwnTask = useCan("task:update:own");

  const [drawerState, setDrawerState] = useState<DrawerState>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileColumnState, setMobileColumnState] = useState<{
    projectId: string | undefined;
    boardView: TaskView;
    status: TaskStatus;
  } | null>(null);
  const [taskConfirm, setTaskConfirm] = useState<{
    task: Task;
    permanent: boolean;
  } | null>(null);
  const [keepArchivedTask, setKeepArchivedTask] = useState<Task | null>(null);
  const taskColumnsRef = useRef<HTMLDivElement>(null);
  const scrollTaskColumns = (direction: 1 | -1) => {
    const columns = taskColumnsRef.current;
    if (!columns) return;
    columns.scrollBy({
      left: direction * columns.clientWidth * 0.85,
      behavior: "smooth",
    });
  };

  // Notifications link here with ?task=<id> (open that task's updates) or
  // ?updates=1 (open the project-wide updates panel).
  const linkedTaskId = searchParams.get("task");
  const updatesOpen = searchParams.get("updates") === "1";
  // Which message the link points at, to scroll to and highlight.
  const linkedMessageId = searchParams.get("message");

  const requestedView = searchParams.get("view");
  const boardView: TaskView = TASK_VIEWS.some(
    (view) => view.value === requestedView,
  )
    ? (requestedView as TaskView)
    : "active";
  const visibleMobileColumn =
    mobileColumnState !== null &&
    mobileColumnState.projectId === projectId &&
    mobileColumnState.boardView === boardView
      ? mobileColumnState.status
      : "todo";
  useEffect(() => {
    taskColumnsRef.current?.scrollTo({ left: 0, behavior: "instant" });
  }, [boardView, projectId]);
  const sortOptions = getLifecycleSortOptions(boardView);
  const requestedSort = `${searchParams.get("sortBy")}:${searchParams.get("sortOrder")}`;
  const selectedSort = sortOptions.some(
    (option) => option.value === requestedSort,
  )
    ? (requestedSort as LifecycleSort)
    : defaultLifecycleSort(boardView);
  const [sortBy, sortOrder] = selectedSort.split(":") as [
    NonNullable<TaskFilters["sortBy"]>,
    "asc" | "desc",
  ];
  const filters: TaskFilters = {
    assigneeId: searchParams.get("assignee") ?? undefined,
    priority:
      (searchParams.get("priority") as TaskPriority | null) ?? undefined,
    mine: searchParams.get("mine") === "true" ? true : undefined,
    sortBy,
    sortOrder,
  };
  // Tab counts follow the same filters as the board, but not its sort order.
  const countFilters: TaskFilters = {
    assigneeId: filters.assigneeId,
    priority: filters.priority,
    mine: filters.mine,
  };
  const visibleStatuses: (TaskStatus | undefined)[] =
    boardView === "active"
      ? ACTIVE_STATUSES
      : boardView === "completed"
        ? ["done"]
        : [undefined];

  const membersQuery = useMembers(orgId);
  const members = membersQuery.data ?? [];
  const projectQuery = useProject(orgId, projectId ?? "");
  const unarchiveProject = useUnarchiveProject(orgId);
  const statsQuery = useTaskStats(orgId, projectId ?? "");
  const viewCountsQuery = useTaskViewCounts(
    orgId,
    projectId ?? "",
    countFilters,
  );
  const linkedTaskQuery = useTask(orgId, linkedTaskId);
  const updateStatus = useUpdateTaskStatus(orgId, projectId ?? "", filters);
  const archiveTask = useArchiveTask(orgId, projectId ?? "");
  const unarchiveTask = useUnarchiveTask(orgId, projectId ?? "");
  const restoreTask = useRestoreTask(orgId, projectId ?? "");
  const keepPlanArchivedTask = useKeepPlanArchived(orgId, "task");
  const deleteTask = useDeleteTask(orgId, projectId ?? "");
  const deleteTaskPermanently = useDeleteTaskPermanently(
    orgId,
    projectId ?? "",
  );
  useMarkReadWhenViewed(
    orgId,
    updatesOpen && projectId ? { kind: "project", projectId } : null,
  );

  if (!projectId) {
    return <NotFound />;
  }

  const setParam = (key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  };

  const handleStatusChange = (task: Task, newStatus: TaskStatus) => {
    updateStatus.mutate(
      { task, newStatus },
      {
        onSuccess: () => {
          if (newStatus === "done") {
            setParam("view", "completed");
            toast.success("Task marked complete", {
              description:
                "Finished tasks move to Completed. Archive them to hide them from everyday work.",
            });
          }
        },
        onError: (error) => {
          const parsed = parseApiError(error);
          toast.error(parsed.message);
        },
      },
    );
  };

  // Forget the link once its task closes, so it doesn't reopen.
  const clearTaskLink = () => {
    if (!linkedTaskId && !linkedMessageId) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      next.delete("message");
      return next;
    });
  };

  const closeDrawer = () => {
    setDrawerState(null);
    clearTaskLink();
  };

  const openTaskFromBoard = (task: Task) => {
    setDrawerState({ mode: "edit", task });
    clearTaskLink();
  };

  const closeUpdates = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("updates");
      next.delete("message");
      return next;
    });
  };

  // From the project feed: close the updates panel and open that task's
  // updates, the same way a notification link does.
  const openTaskUpdates = (taskId: string) => {
    setDrawerState(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("updates");
      next.delete("message");
      next.set("task", taskId);
      return next;
    });
  };

  const currentUserId = auth.user?.id ?? "";
  const isArchived = projectQuery.data?.archivedAt != null;

  // Deleted or in the bin (or never existed): say so instead of an empty board.
  if (projectQuery.isError) {
    return (
      <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="font-medium text-slate-800 dark:text-slate-100">
            This project isn&apos;t available
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            It may have been moved to the bin or deleted. Projects in the bin
            can be restored from the Projects page.
          </p>
          <Link
            to={`/orgs/${orgId}/projects`}
            className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            ← Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const stats = statsQuery.data;
  const atTaskLimit =
    stats?.activeLimit != null && stats.activeCount >= stats.activeLimit;
  const canPostProjectUpdates = canLead || (stats?.assignedToMe ?? false);
  const planName = stats ? PLAN_NAMES[stats.plan] : "";
  // A linked task (from a notification or the project feed) wins over one
  // opened from the board, so following a link always shows what it points to.
  const openDrawer: DrawerState =
    linkedTaskId && linkedTaskQuery.data
      ? { mode: "edit", task: linkedTaskQuery.data, tab: "activity" }
      : drawerState;

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/orgs/${orgId}/projects`}
              className="text-sm text-slate-500 hover:text-teal-700 hover:underline dark:text-slate-400 dark:hover:text-teal-400"
            >
              ← Projects
            </Link>
            <h1 className="mt-1 break-words text-2xl font-bold text-slate-900 dark:text-slate-50">
              {projectQuery.data?.name ?? "Loading…"}
            </h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-2">
            <MuteToggle orgId={orgId} projectId={projectId} iconOnly />
            <Button
              variant="secondary"
              data-tour="tasks-updates"
              className="min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
              onClick={() => setParam("updates", "1")}
            >
              <span className="sm:hidden">Updates</span>
              <span className="hidden sm:inline">Project updates</span>
            </Button>
            {canCreate && !isArchived && (
              <Button
                data-tour="tasks-create"
                className="min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
                onClick={() => setDrawerState({ mode: "create" })}
                disabled={atTaskLimit || paused || growthBlocked}
                title={
                  paused
                    ? PAUSED_HINT
                    : growthBlocked
                      ? GROWTH_BLOCKED_HINT
                      : atTaskLimit
                        ? `This project has reached the ${planName} plan's active task limit`
                        : undefined
                }
              >
                New task
              </Button>
            )}
          </div>
        </div>

        {stats && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm sm:mt-3 sm:gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 font-medium ${
                atTaskLimit
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {stats.activeLimit === null
                ? `${stats.activeCount} active ${stats.activeCount === 1 ? "task" : "tasks"}`
                : `${stats.activeCount} / ${stats.activeLimit} active tasks`}
            </span>
            {atTaskLimit && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {`${planName} plan limit reached. Finish a task to add or reopen another`}
                {role === "admin" && (
                  <>
                    {", or "}
                    <Link
                      to={`/orgs/${orgId}/settings`}
                      className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      upgrade your plan
                    </Link>
                    {" for more"}
                  </>
                )}
                .
              </span>
            )}
          </div>
        )}

        {linkedTaskId && linkedTaskQuery.isError && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-200 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <span>That task was deleted or isn&apos;t visible to you.</span>
            <button
              type="button"
              onClick={() => setParam("task", null)}
              className="font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Dismiss
            </button>
          </div>
        )}

        {isArchived && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <p>
              This project is archived. Existing tasks are still visible, but
              new tasks can&apos;t be created here.
            </p>
            {canManageProject && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={unarchiveProject.isPending}
                onClick={() =>
                  unarchiveProject.mutate(projectId, {
                    onSuccess: () => toast.success("Project unarchived"),
                    onError: (error) =>
                      toast.error(parseApiError(error).message),
                  })
                }
              >
                Unarchive
              </Button>
            )}
          </div>
        )}

        <div
          data-tour="tasks-tabs"
          className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:mt-5"
        >
          <ViewTabs
            label="Task lists"
            value={boardView}
            onChange={(value) =>
              setParam("view", value === "active" ? null : value)
            }
            tabs={TASK_VIEWS.map((tab) => ({
              ...tab,
              count: viewCountsQuery.data?.[tab.value],
            }))}
          />
        </div>

        <div data-tour="tasks-filters" className="mt-3 sm:mt-4">
          <div className="flex flex-nowrap items-center gap-1.5 sm:hidden">
            <Button
              variant="secondary"
              onClick={() => setFiltersOpen(true)}
              className="shrink-0 px-3"
              aria-label={`Filters${Number(Boolean(filters.priority)) + Number(Boolean(filters.assigneeId)) > 0 ? `, ${Number(Boolean(filters.priority)) + Number(Boolean(filters.assigneeId))} active` : ""}`}
            >
              Filters
              {Number(Boolean(filters.priority)) +
                Number(Boolean(filters.assigneeId)) >
                0 && (
                <span
                  aria-hidden="true"
                  className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-xs text-teal-800 dark:bg-teal-900 dark:text-teal-200"
                >
                  {Number(Boolean(filters.priority)) +
                    Number(Boolean(filters.assigneeId))}
                </span>
              )}
            </Button>
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <span className="shrink-0">Sort by</span>
              <select
                aria-label="Sort by"
                value={selectedSort}
                onChange={(event) => {
                  const [field, order] = event.target.value.split(":");
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("sortBy", field);
                    next.set("sortOrder", order);
                    return next;
                  });
                }}
                className="min-w-0 flex-1 appearance-none truncate bg-transparent pr-4 text-sm text-slate-800 focus:outline-none dark:text-slate-100"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="pointer-events-none -ml-5 size-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m5 7.5 5 5 5-5" />
              </svg>
            </label>
            <label className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-1 text-xs text-slate-600 dark:text-slate-300 sm:ml-auto sm:gap-2 sm:px-2 sm:text-sm">
              <input
                type="checkbox"
                checked={filters.mine ?? false}
                onChange={(event) =>
                  setParam("mine", event.target.checked ? "true" : null)
                }
                className="size-4 accent-teal-600"
              />
              My tasks
            </label>
          </div>
          <div className="hidden items-center gap-3 sm:flex sm:flex-wrap">
            <select
              aria-label="Filter by priority"
              value={filters.priority ?? ""}
              onChange={(event) =>
                setParam("priority", event.target.value || null)
              }
              className={`${selectStyles} w-full sm:w-auto`}
            >
              <option value="">All priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>

            <select
              aria-label="Filter by assignee"
              value={filters.assigneeId ?? ""}
              onChange={(event) =>
                setParam("assignee", event.target.value || null)
              }
              className={`${selectStyles} w-full sm:w-auto`}
            >
              <option value="">Everyone</option>
              {members.map((member) => (
                <option key={member._id} value={member.userId.id}>
                  {member.userId.name}
                </option>
              ))}
            </select>

            <label className="flex min-h-9 min-w-0 flex-col items-start gap-1.5 text-sm text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:gap-2 lg:ml-auto lg:flex-nowrap lg:whitespace-nowrap">
              <span className="shrink-0">Sort by</span>
              <select
                aria-label="Sort tasks"
                value={selectedSort}
                onChange={(event) => {
                  const [field, order] = event.target.value.split(":");
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("sortBy", field);
                    next.set("sortOrder", order);
                    return next;
                  });
                }}
                className={`${selectStyles} w-full min-w-0 sm:w-auto sm:min-w-64`}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <Modal
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title="Task filters"
        >
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              Priority
              <select
                aria-label="Filter by priority"
                value={filters.priority ?? ""}
                onChange={(event) =>
                  setParam("priority", event.target.value || null)
                }
                className={`${selectStyles} mt-1.5 w-full`}
              >
                <option value="">All priorities</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              Assignee
              <select
                aria-label="Filter by assignee"
                value={filters.assigneeId ?? ""}
                onChange={(event) =>
                  setParam("assignee", event.target.value || null)
                }
                className={`${selectStyles} mt-1.5 w-full`}
              >
                <option value="">Everyone</option>
                {members.map((member) => (
                  <option key={member._id} value={member.userId.id}>
                    {member.userId.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-between gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setSearchParams((previous) => {
                    const next = new URLSearchParams(previous);
                    next.delete("priority");
                    next.delete("assignee");
                    return next;
                  });
                }}
              >
                Clear filters
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>Done</Button>
            </div>
          </div>
        </Modal>

        {boardView !== "active" && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {boardView === "completed"
              ? "Completed tasks are kept here. Reopen one to return it to active work."
              : boardView === "archived"
                ? "Archived tasks are hidden from everyday work and can be unarchived."
                : "Binned tasks can be restored for 30 days before permanent deletion."}
          </p>
        )}

        {visibleStatuses.length > 1 && (
          <div className="mt-3 flex items-center justify-between gap-3 md:hidden">
            <p
              id="task-columns-hint"
              className="flex min-w-0 items-center whitespace-nowrap text-xs text-slate-600 sm:text-sm dark:text-slate-300"
            >
              {visibleMobileColumn === "todo"
                ? "→ Swipe to see In progress"
                : "← Swipe to see To do"}
            </p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label="Previous task column"
                onClick={() => scrollTaskColumns(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <span aria-hidden="true">←</span>
              </button>
              <button
                type="button"
                aria-label="Next task column"
                onClick={() => scrollTaskColumns(1)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}

        <div
          ref={taskColumnsRef}
          onScroll={(event) => {
            const columns = event.currentTarget;
            const nextColumn: TaskStatus =
              columns.scrollLeft > columns.clientWidth / 2
                ? "in_progress"
                : "todo";
            setMobileColumnState((current) =>
              current?.projectId === projectId &&
              current.boardView === boardView &&
              current.status === nextColumn
                ? current
                : { projectId, boardView, status: nextColumn },
            );
          }}
          aria-describedby={
            visibleStatuses.length > 1 ? "task-columns-hint" : undefined
          }
          className="mt-4 flex snap-x snap-mandatory flex-row gap-3 overflow-x-auto overscroll-x-contain pb-4"
        >
          {visibleStatuses.map((status) => (
            <TaskColumn
              key={status ?? boardView}
              orgId={orgId}
              projectId={projectId}
              view={boardView}
              status={status}
              filters={filters}
              members={members}
              canChangeStatus={(task) =>
                canChangeTaskStatus(
                  task,
                  currentUserId,
                  canUpdateAny,
                  canUpdateOwn,
                )
              }
              onStatusChange={handleStatusChange}
              onTaskClick={openTaskFromBoard}
              canEdit={(task) =>
                task.status !== "done" &&
                !task.archivedAt &&
                !task.deletedAt &&
                (canUpdateAny ||
                  (canUpdateOwnTask &&
                    (task.assigneeIds ?? []).includes(currentUserId)))
              }
              canManage={canManageTasks}
              onArchive={(task) =>
                archiveTask.mutate(task._id, {
                  onSuccess: () => toast.success("Task archived"),
                  onError: (error) => toast.error(parseApiError(error).message),
                })
              }
              onUnarchive={(task) =>
                unarchiveTask.mutate(task._id, {
                  onSuccess: () => {
                    const view = taskViewAfterUnarchive(task.status);
                    setParam("view", view === "active" ? null : view);
                    toast.success("Task unarchived");
                  },
                  onError: (error) => toast.error(parseApiError(error).message),
                })
              }
              onRestore={(task) =>
                restoreTask.mutate(task._id, {
                  onSuccess: () => toast.success("Task restored"),
                  onError: (error) => toast.error(parseApiError(error).message),
                })
              }
              onDelete={(task) => setTaskConfirm({ task, permanent: false })}
              onDeletePermanently={(task) =>
                setTaskConfirm({ task, permanent: true })
              }
              onKeepArchived={setKeepArchivedTask}
            />
          ))}
        </div>
      </div>

      <TaskDrawer
        key={openDrawer?.mode === "edit" ? openDrawer.task._id : "create"}
        open={openDrawer !== null}
        onClose={closeDrawer}
        orgId={orgId}
        projectId={projectId}
        members={members}
        task={openDrawer?.mode === "edit" ? openDrawer.task : null}
        initialTab={openDrawer?.mode === "edit" ? openDrawer.tab : undefined}
        focusActivityId={linkedTaskId ? linkedMessageId : null}
      />

      <Modal
        open={taskConfirm !== null}
        onClose={() => setTaskConfirm(null)}
        title={
          taskConfirm?.permanent
            ? "Delete task permanently?"
            : "Move task to bin?"
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {taskConfirm?.permanent
            ? `“${taskConfirm.task.title}” and its updates will be deleted permanently. This cannot be undone.`
            : `“${taskConfirm?.task.title}” will move to the bin and can be restored for 30 days.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTaskConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteTask.isPending || deleteTaskPermanently.isPending}
            onClick={() => {
              if (!taskConfirm) return;
              const mutation = taskConfirm.permanent
                ? deleteTaskPermanently
                : deleteTask;
              mutation.mutate(taskConfirm.task._id, {
                onSuccess: () => {
                  toast.success(
                    taskConfirm.permanent
                      ? "Task deleted permanently"
                      : "Task moved to the bin",
                  );
                  setTaskConfirm(null);
                },
                onError: (error) => toast.error(parseApiError(error).message),
              });
            }}
          >
            {taskConfirm?.permanent ? "Delete permanently" : "Move to bin"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={keepArchivedTask !== null}
        onClose={() => setKeepArchivedTask(null)}
        title="Keep this task archived?"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This will keep {keepArchivedTask?.title ?? "this task"} archived and
          remove it from the list of items that can be restored after a plan
          change.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setKeepArchivedTask(null)}>
            Cancel
          </Button>
          <Button
            loading={keepPlanArchivedTask.isPending}
            onClick={() => {
              if (!keepArchivedTask) return;
              keepPlanArchivedTask.mutate(keepArchivedTask._id, {
                onSuccess: () => {
                  toast.success(
                    `"${keepArchivedTask.title}" will stay archived`,
                  );
                  setKeepArchivedTask(null);
                },
                onError: (error) => toast.error(parseApiError(error).message),
              });
            }}
          >
            Keep archived
          </Button>
        </div>
      </Modal>

      <Modal
        open={updatesOpen}
        onClose={closeUpdates}
        title={`${projectQuery.data?.name ?? "Project"} updates`}
        size="lg"
      >
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          {canLead
            ? "Everything shared in this project, from every task. Send to all assignees, or @mention people to send it only to them."
            : "Everything shared in this project that you can see. Send to all assignees, or @mention people to send it only to them."}
        </p>
        <ActivityFeed
          orgId={orgId}
          scope={{ kind: "project", id: projectId }}
          canLead={canLead}
          canContribute={!canLead && canPostProjectUpdates}
          onOpenTask={openTaskUpdates}
          focusId={linkedMessageId}
        />
      </Modal>
    </div>
  );
}

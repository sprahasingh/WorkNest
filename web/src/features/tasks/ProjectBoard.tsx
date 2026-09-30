import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { useMembers } from "@/features/members/queries";
import { useProject, useUnarchiveProject } from "@/features/projects/queries";
import { parseApiError } from "@/lib/apiError";
import { NotFound } from "@/pages/NotFound";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/Modal";
import { TaskColumn } from "./TaskColumn";
import { TaskDrawer } from "./TaskDrawer";
import { ActivityFeed } from "./ActivityFeed";
import {
  useTask,
  useTaskStats,
  useUpdateTaskStatus,
  type TaskFilters,
} from "./queries";
import { canChangeTaskStatus } from "./ownership";
import { useMarkReadWhenViewed } from "@/features/notifications/queries";
import { PLAN_NAMES } from "@/lib/plans";
import type { Task, TaskStatus, TaskPriority } from "./api";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];

const selectStyles =
  "rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

type DrawerState =
  | { mode: "create" }
  | { mode: "edit"; task: Task; tab?: "details" | "activity" }
  | null;

export function ProjectBoard() {
  const { orgId, role } = useOrg();
  const { projectId } = useParams<{ projectId: string }>();
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canUpdateAny = useCan("task:update:any");
  const canUpdateOwn = useCan("task:update:own");
  const canCreate = useCan("task:create");
  const canLead = useCan("task:request-update");
  const canManageProject = useCan("project:write");

  const [drawerState, setDrawerState] = useState<DrawerState>(null);

  // Notifications link here with ?task=<id> (open that task's updates) or
  // ?updates=1 (open the project-wide updates panel).
  const linkedTaskId = searchParams.get("task");
  const updatesOpen = searchParams.get("updates") === "1";

  const filters: TaskFilters = {
    assigneeId: searchParams.get("assignee") ?? undefined,
    priority:
      (searchParams.get("priority") as TaskPriority | null) ?? undefined,
    mine: searchParams.get("mine") === "true" ? true : undefined,
  };

  const membersQuery = useMembers(orgId);
  const members = membersQuery.data ?? [];
  const projectQuery = useProject(orgId, projectId ?? "");
  const unarchiveProject = useUnarchiveProject(orgId);
  const statsQuery = useTaskStats(orgId, projectId ?? "");
  const linkedTaskQuery = useTask(orgId, linkedTaskId);
  const updateStatus = useUpdateTaskStatus(orgId, projectId ?? "", filters);
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
        onError: (error) => {
          const parsed = parseApiError(error);
          toast.error(parsed.message);
        },
      },
    );
  };

  const closeDrawer = () => {
    setDrawerState(null);
    if (linkedTaskId) setParam("task", null);
  };

  const openTaskFromBoard = (task: Task) => {
    setDrawerState({ mode: "edit", task });
    if (linkedTaskId) setParam("task", null);
  };

  // From the project feed: close the updates panel and open that task's
  // updates, the same way a notification link does.
  const openTaskUpdates = (taskId: string) => {
    setDrawerState(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("updates");
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to={`/orgs/${orgId}/projects`}
              className="text-sm text-slate-500 hover:text-teal-700 hover:underline dark:text-slate-400 dark:hover:text-teal-400"
            >
              ← Projects
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
              {projectQuery.data?.name ?? "Loading…"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setParam("updates", "1")}
            >
              Project updates
            </Button>
            {canCreate && !isArchived && (
              <Button
                onClick={() => setDrawerState({ mode: "create" })}
                disabled={atTaskLimit}
                title={
                  atTaskLimit
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
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
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
            <span className="text-slate-500 dark:text-slate-400">
              {stats.activeLimit === null
                ? `No active task limit on the ${planName} plan`
                : atTaskLimit
                  ? `${planName} plan limit reached. Finish a task to add or reopen another`
                  : `${planName} plan limit for this project`}
              {atTaskLimit && role === "admin" && (
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
              {role === "member" &&
                " Counts every active task here, including ones assigned to others."}
            </span>
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={filters.priority ?? ""}
            onChange={(event) =>
              setParam("priority", event.target.value || null)
            }
            className={selectStyles}
          >
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <select
            value={filters.assigneeId ?? ""}
            onChange={(event) =>
              setParam("assignee", event.target.value || null)
            }
            className={selectStyles}
          >
            <option value="">Everyone</option>
            {members.map((member) => (
              <option key={member._id} value={member.userId.id}>
                {member.userId.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={filters.mine ?? false}
              onChange={(event) =>
                setParam("mine", event.target.checked ? "true" : null)
              }
              className="accent-teal-600"
            />
            My tasks
          </label>
        </div>

        <div className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
          {STATUSES.map((status) => (
            <TaskColumn
              key={status}
              orgId={orgId}
              projectId={projectId}
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
      />

      <Modal
        open={updatesOpen}
        onClose={() => setParam("updates", null)}
        title={`${projectQuery.data?.name ?? "Project"} updates`}
        size="lg"
      >
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          {canLead
            ? "Everything shared in this project, from every task. Ask everyone for an update at once, or reply to questions."
            : "Everything shared in this project that you can see. Post an update on your work or ask a question about the project."}
        </p>
        <ActivityFeed
          orgId={orgId}
          scope={{ kind: "project", id: projectId }}
          canLead={canLead}
          canContribute={!canLead && canPostProjectUpdates}
          onOpenTask={openTaskUpdates}
        />
      </Modal>
    </div>
  );
}

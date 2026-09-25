import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { useMembers } from "@/features/members/queries";
import { useProject } from "@/features/projects/queries";
import { parseApiError } from "@/lib/apiError";
import { NotFound } from "@/pages/NotFound";
import { TaskColumn } from "./TaskColumn";
import { TaskDrawer } from "./TaskDrawer";
import { useUpdateTaskStatus, type TaskFilters } from "./queries";
import { canChangeTaskStatus } from "./ownership";
import type { Task, TaskStatus, TaskPriority } from "./api";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];

export function ProjectBoard() {
  const { orgId } = useOrg();
  const { projectId } = useParams<{ projectId: string }>();
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canUpdateAny = useCan("task:update:any");
  const canUpdateOwn = useCan("task:update:own");
  const canCreate = useCan("task:create");

  const [drawerState, setDrawerState] = useState<
    { mode: "create" } | { mode: "edit"; task: Task } | null
  >(null);

  const filters: TaskFilters = {
    assigneeId: searchParams.get("assignee") ?? undefined,
    priority:
      (searchParams.get("priority") as TaskPriority | null) ?? undefined,
    mine: searchParams.get("mine") === "true" ? true : undefined,
  };

  const membersQuery = useMembers(orgId);
  const members = membersQuery.data ?? [];
  const projectQuery = useProject(orgId, projectId ?? "");
  const updateStatus = useUpdateTaskStatus(orgId, projectId ?? "", filters);

  if (!projectId) {
    return <NotFound />;
  }

  const setFilter = (key: string, value: string | null) => {
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

  const currentUserId = auth.user?.id ?? "";

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <Link
              to={`/orgs/${orgId}/projects`}
              className="text-sm text-slate-500 hover:underline"
            >
              ← Projects
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-800">
              {projectQuery.data?.name ?? "Loading…"}
            </h1>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={() => setDrawerState({ mode: "create" })}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white"
            >
              New task
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={filters.priority ?? ""}
            onChange={(event) => setFilter("priority", event.target.value || null)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <select
            value={filters.assigneeId ?? ""}
            onChange={(event) => setFilter("assignee", event.target.value || null)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Everyone</option>
            {members.map((member) => (
              <option key={member._id} value={member.userId.id}>
                {member.userId.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={filters.mine ?? false}
              onChange={(event) =>
                setFilter("mine", event.target.checked ? "true" : null)
              }
            />
            My tasks
          </label>
        </div>

        <div className="mt-6 flex gap-4 overflow-x-auto pb-4">
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
              onTaskClick={(task) => setDrawerState({ mode: "edit", task })}
            />
          ))}
        </div>
      </div>

      <TaskDrawer
        key={drawerState?.mode === "edit" ? drawerState.task._id : "create"}
        open={drawerState !== null}
        onClose={() => setDrawerState(null)}
        orgId={orgId}
        projectId={projectId}
        filters={filters}
        members={members}
        task={drawerState?.mode === "edit" ? drawerState.task : null}
      />
    </div>
  );
}

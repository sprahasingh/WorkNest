import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { orgKeys } from "@/features/org/queries";
import { dashboardKeys } from "@/features/dashboard/queries";
import { parseApiError } from "@/lib/apiError";
import {
  restorePlanArchivedProjects,
  PLAN_RESTORE_BATCH_SIZE,
  type PlanArchivedTaskCandidate,
  type Project,
} from "@/features/projects/api";
import {
  projectKeys,
  refreshRestoreCandidates,
} from "@/features/projects/queries";

interface RestoreProjectsPromptProps {
  orgId: string;
  projects: Project[];
  tasks: PlanArchivedTaskCandidate[];
  onClose: () => void;
}

export function RestoreProjectsPrompt({
  orgId,
  projects,
  tasks,
  onClose,
}: RestoreProjectsPromptProps) {
  const queryClient = useQueryClient();
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() =>
    projects.map((project) => project._id),
  );
  const [selectedTaskIds, setSelectedTaskIds] = useState(() =>
    tasks.map((task) => task._id),
  );
  const closePrompt = () => {
    if (!isRestoring) onClose();
  };

  const submitRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    const restored = {
      projects: [] as Project[],
      tasks: [] as { _id: string }[],
    };
    const skipped = { projects: 0, tasks: 0 };
    let shouldClose = true;
    const batchCount = Math.max(
      Math.ceil(selectedIds.length / PLAN_RESTORE_BATCH_SIZE),
      Math.ceil(selectedTaskIds.length / PLAN_RESTORE_BATCH_SIZE),
    );
    try {
      for (let index = 0; index < batchCount; index += 1) {
        const result = await restorePlanArchivedProjects(
          orgId,
          selectedIds.slice(
            index * PLAN_RESTORE_BATCH_SIZE,
            (index + 1) * PLAN_RESTORE_BATCH_SIZE,
          ),
          selectedTaskIds.slice(
            index * PLAN_RESTORE_BATCH_SIZE,
            (index + 1) * PLAN_RESTORE_BATCH_SIZE,
          ),
        );
        restored.projects.push(...result.projects);
        restored.tasks.push(...result.tasks);
        skipped.projects += result.skipped.projects;
        skipped.tasks += result.skipped.tasks;
      }
      if (skipped.projects || skipped.tasks) {
        shouldClose = false;
        const restoredCount = restored.projects.length + restored.tasks.length;
        toast.warning(
          restoredCount
            ? `${restored.projects.length} project${restored.projects.length === 1 ? "" : "s"} and ${restored.tasks.length} task${restored.tasks.length === 1 ? "" : "s"} restored`
            : "No selected resources fit the available plan capacity",
          {
            description: `${skipped.projects} project${skipped.projects === 1 ? "" : "s"} and ${skipped.tasks} task${skipped.tasks === 1 ? "" : "s"} remain archived because of plan capacity. Free capacity and try again, or choose Later to dismiss this prompt.`,
          },
        );
      } else {
        toast.success(
          `${restored.projects.length} project${restored.projects.length === 1 ? "" : "s"} and ${restored.tasks.length} task${restored.tasks.length === 1 ? "" : "s"} restored`,
        );
      }
    } catch (error) {
      shouldClose =
        restored.projects.length + restored.tasks.length > 0 &&
        skipped.projects + skipped.tasks === 0;
      const message = parseApiError(error).message;
      const partialResult =
        restored.projects.length +
        restored.tasks.length +
        skipped.projects +
        skipped.tasks;
      const description = partialResult
        ? skipped.projects || skipped.tasks
          ? `${restored.projects.length} project${restored.projects.length === 1 ? "" : "s"} and ${restored.tasks.length} task${restored.tasks.length === 1 ? "" : "s"} restored; ${skipped.projects} project${skipped.projects === 1 ? "" : "s"} and ${skipped.tasks} task${skipped.tasks === 1 ? "" : "s"} remain archived because of plan capacity. Remaining batches stopped.`
          : `${restored.projects.length} project${restored.projects.length === 1 ? "" : "s"} and ${restored.tasks.length} task${restored.tasks.length === 1 ? "" : "s"} restored before the remaining batches stopped.`
        : undefined;
      toast.error(message, {
        description,
      });
    } finally {
      void refreshRestoreCandidates(queryClient, orgId);
      void queryClient.invalidateQueries({
        queryKey: projectKeys.all(orgId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
      void queryClient.invalidateQueries({
        queryKey: orgKeys.detail(orgId),
      });
      setIsRestoring(false);
      if (shouldClose) onClose();
    }
  };

  return (
    <Modal open onClose={closePrompt} title="Review archived projects">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Your upgrade is complete. Choose force-archived projects and tasks to
        restore. Tasks in selected projects return with them when capacity
        allows.
      </p>
      {projects.length > 0 && (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={selectedIds.length === projects.length}
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked
                    ? projects.map((project) => project._id)
                    : [],
                )
              }
            />
            Restore all eligible projects
          </label>
          <div className="mt-3 max-h-64 space-y-2 overflow-auto">
            {projects.map((project) => (
              <label
                key={project._id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(project._id)}
                  onChange={(event) =>
                    setSelectedIds((selected) =>
                      event.target.checked
                        ? [...selected, project._id]
                        : selected.filter((id) => id !== project._id),
                    )
                  }
                />
                <span>
                  {project.name}{" "}
                  <span className="text-slate-500">({project.key})</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {tasks.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Force-archived tasks in active projects
          </h3>
          <label className="mt-2 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={selectedTaskIds.length === tasks.length}
              onChange={(event) =>
                setSelectedTaskIds(
                  event.target.checked ? tasks.map((task) => task._id) : [],
                )
              }
            />
            Restore all eligible tasks
          </label>
          <div className="mt-3 max-h-48 space-y-2 overflow-auto">
            {tasks.map((task) => (
              <label
                key={task._id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selectedTaskIds.includes(task._id)}
                  onChange={(event) =>
                    setSelectedTaskIds((selected) =>
                      event.target.checked
                        ? [...selected, task._id]
                        : selected.filter((id) => id !== task._id),
                    )
                  }
                />
                <span>
                  {task.title}{" "}
                  <span className="text-slate-500">
                    ({task.projectName} · {task.projectKey})
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={closePrompt}
          disabled={isRestoring}
        >
          Later
        </Button>
        <Button
          disabled={
            isRestoring || (!selectedIds.length && !selectedTaskIds.length)
          }
          loading={isRestoring}
          onClick={() => void submitRestore()}
        >
          Restore selected
        </Button>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { Modal } from "@/components/Modal";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { applyFieldErrors, parseApiError } from "@/lib/apiError";
import { PLAN_LIMITS, PLAN_NAMES } from "@/lib/plans";
import { dateInputValueInTimeZone, formatDateInTimeZone } from "@/lib/time";
import { useOrgDetails } from "@/features/org/queries";
import type { Project, ProjectSummary, ProjectView } from "./api";
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useDeleteProjectPermanently,
  useProjects,
  useRestoreProject,
  useUnarchiveProject,
  useUpdateProject,
} from "./queries";

const createProjectFormSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, "Key must be 2-6 uppercase letters"),
  description: z.string().trim().max(500).optional(),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: z.string().optional(),
});

type CreateProjectFormValues = z.infer<typeof createProjectFormSchema>;

const CREATE_PROJECT_FIELDS = [
  "name",
  "key",
  "description",
  "priority",
  "dueDate",
] as const;

type ConfirmAction = "archive" | "bin" | "permanent";

interface ConfirmTarget {
  project: Project;
  action: ConfirmAction;
}

type ProjectListView = ProjectView | "completed";
type ProjectSort =
  | "dueDate:asc"
  | "dueDate:desc"
  | "createdAt:asc"
  | "createdAt:desc"
  | "priority:desc"
  | "priority:asc";

const VIEWS: { value: ProjectListView; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "bin", label: "Bin" },
];

const DAY_MS = 86_400_000;

function daysUntil(iso: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS),
  );
}

export function ProjectsPage() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const canWrite = useCan("project:write");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [view, setView] = useState<ProjectListView>("active");
  const [sortBy, setSortBy] = useState<ProjectSort>("createdAt:desc");

  const apiView = view === "completed" ? "active" : view;
  const { data, isPending, isError } = useProjects(orgId, { view: apiView });
  // The active list is always loaded, so every tab count shows and returning
  // to it is instant.
  const activeList = useProjects(orgId, { view: "active" });
  const completedProjects = (activeList.data?.projects ?? []).filter(
    (project) =>
      project.taskCount > 0 && project.completedTaskCount === project.taskCount,
  );
  const projects =
    view === "completed"
      ? completedProjects
      : view === "active"
        ? data?.projects.filter(
            (project) =>
              project.taskCount === 0 ||
              project.completedTaskCount !== project.taskCount,
          )
        : data?.projects;
  const sortedProjects = [...(projects ?? [])].sort((left, right) => {
    const [field, direction] = sortBy.split(":") as [
      "dueDate" | "createdAt" | "priority",
      "asc" | "desc",
    ];
    if (field === "priority") {
      const priorityOrder =
        direction === "desc"
          ? { high: 0, medium: 1, low: 2 }
          : { low: 0, medium: 1, high: 2 };
      return priorityOrder[left.priority] - priorityOrder[right.priority];
    }

    if (field === "dueDate" && (!left.dueDate || !right.dueDate)) {
      if (!left.dueDate && !right.dueDate) return 0;
      const noDateOrder = direction === "asc" ? 1 : -1;
      return !left.dueDate ? noDateOrder : -noDateOrder;
    }

    const leftTime = new Date(
      field === "dueDate" ? left.dueDate! : left.createdAt,
    ).getTime();
    const rightTime = new Date(
      field === "dueDate" ? right.dueDate! : right.createdAt,
    ).getTime();
    const dateOrder = (leftTime - rightTime) * (direction === "asc" ? 1 : -1);
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return (
      dateOrder ||
      priorityOrder[left.priority] - priorityOrder[right.priority] ||
      left.name.localeCompare(right.name)
    );
  });
  const counts = data?.counts ?? activeList.data?.counts;
  const activeProjectCount = activeList.data
    ? activeList.data.projects.length - completedProjects.length
    : undefined;
  const completedProjectCount = activeList.data
    ? completedProjects.length
    : undefined;
  const retentionDays = data?.binRetentionDays ?? 30;

  const org = useOrgDetails(orgId).data;
  const activeTaskLimit = org ? PLAN_LIMITS[org.plan].activeTaskLimit : null;
  const atProjectLimit = org ? org.projectCount >= org.projectLimit : false;
  const createProject = useCreateProject(orgId);
  const updateProject = useUpdateProject(orgId);
  const archiveProject = useArchiveProject(orgId);
  const deleteProject = useDeleteProject(orgId);
  const unarchiveProject = useUnarchiveProject(orgId);
  const restoreProject = useRestoreProject(orgId);
  const deletePermanently = useDeleteProjectPermanently(orgId);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectFormSchema),
  });

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setEditingProject(null);
    setFormError(null);
    reset();
  };

  const onCreateSubmit = async (values: CreateProjectFormValues) => {
    setFormError(null);
    try {
      if (editingProject) {
        await updateProject.mutateAsync({
          projectId: editingProject._id,
          input: {
            name: values.name,
            description: values.description,
            priority: values.priority,
            dueDate: values.dueDate || null,
          },
        });
        toast.success("Project saved");
      } else {
        await createProject.mutateAsync({
          ...values,
          priority: values.priority,
          dueDate: values.dueDate || undefined,
        });
      }
      closeCreateModal();
    } catch (error) {
      const parsed = parseApiError(error);

      if (parsed.code === "PROJECT_LIMIT_REACHED") {
        closeCreateModal();
        toast.error("Project limit reached", {
          description: "Upgrade your plan to create more projects.",
          action: {
            label: "Settings",
            onClick: () => navigate(`/orgs/${orgId}/settings`),
          },
        });
        return;
      }

      if (Object.keys(parsed.fieldErrors).length === 0) {
        setFormError(parsed.message);
        return;
      }

      const unmatched = applyFieldErrors(
        parsed.fieldErrors,
        CREATE_PROJECT_FIELDS,
        setError,
      );
      if (unmatched.length > 0) {
        setFormError(unmatched.join(" "));
      }
    }
  };

  const openCreateModal = () => {
    setEditingProject(null);
    reset({
      name: "",
      key: "",
      description: "",
      priority: "medium",
      dueDate: "",
    });
    setFormError(null);
    setIsCreateOpen(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    reset({
      name: project.name,
      key: project.key,
      description: project.description ?? "",
      priority: project.priority ?? "medium",
      dueDate: project.dueDate
        ? dateInputValueInTimeZone(project.dueDate, org?.timeZone ?? "UTC")
        : "",
    });
    setFormError(null);
    setIsCreateOpen(true);
  };

  const showError = (error: unknown) => {
    const parsed = parseApiError(error);
    if (parsed.code === "PROJECT_LIMIT_REACHED") {
      toast.error("No free project slot", {
        description:
          "Archive or delete another project, or upgrade your plan, to restore this one.",
        action: {
          label: "Settings",
          onClick: () => navigate(`/orgs/${orgId}/settings`),
        },
      });
      return;
    }
    toast.error(parsed.message);
  };

  const restore = async (project: Project) => {
    try {
      await restoreProject.mutateAsync(project._id);
      toast.success(`Restored "${project.name}"`);
    } catch (error) {
      showError(error);
    }
  };

  const unarchive = async (project: Project) => {
    try {
      await unarchiveProject.mutateAsync(project._id);
      toast.success(`"${project.name}" is active again`);
    } catch (error) {
      showError(error);
    }
  };

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    const { project, action } = confirmTarget;

    try {
      if (action === "archive") {
        await archiveProject.mutateAsync(project._id);
        toast.success(`Archived "${project.name}"`, {
          action: { label: "Undo", onClick: () => void unarchive(project) },
        });
      } else if (action === "bin") {
        await deleteProject.mutateAsync(project._id);
        toast.success(`Moved "${project.name}" to the bin`, {
          description: `It's deleted for good after ${retentionDays} days.`,
          action: { label: "Undo", onClick: () => void restore(project) },
        });
      } else {
        await deletePermanently.mutateAsync(project._id);
        toast.success(`Deleted "${project.name}" permanently`);
      }
    } catch (error) {
      showError(error);
    }
    setConfirmTarget(null);
  };

  const isConfirming =
    archiveProject.isPending ||
    deleteProject.isPending ||
    deletePermanently.isPending;

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              Projects
            </h1>
            {org && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                <span
                  className={cn(
                    "font-medium",
                    atProjectLimit
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-slate-700 dark:text-slate-300",
                  )}
                >
                  {org.projectCount} of {org.projectLimit}
                </span>{" "}
                active project slots used on the {PLAN_NAMES[org.plan]} plan
              </p>
            )}
          </div>
          {canWrite && <Button onClick={openCreateModal}>New project</Button>}
        </div>

        <div
          role="tablist"
          aria-label="Project lists"
          className="mt-4 grid grid-cols-4 gap-1 border-b border-slate-200 dark:border-slate-800"
        >
          {VIEWS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={view === tab.value}
              onClick={() => setView(tab.value)}
              className={cn(
                "flex min-w-0 items-center justify-center gap-0.5 whitespace-nowrap px-0 py-2 text-[10px] font-medium transition-colors sm:gap-2 sm:px-3 sm:text-sm",
                view === tab.value
                  ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              <span className="sm:hidden">
                {tab.value === "completed" ? "Complete" : tab.label}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
              <TabCount
                value={
                  tab.value === "active"
                    ? activeProjectCount
                    : tab.value === "completed"
                      ? completedProjectCount
                      : counts?.[tab.value]
                }
                selected={view === tab.value}
              />
            </button>
          ))}
        </div>

        {view === "bin" && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <span aria-hidden="true">🗑️</span>
            <span>
              Projects in the bin are deleted for good, with their tasks, after{" "}
              {retentionDays} days. Restore one to bring everything back. They
              don&apos;t use a project slot while they&apos;re here.
            </span>
          </p>
        )}

        <label className="mt-5 flex min-w-0 flex-col items-start gap-1.5 text-sm text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0">Sort projects</span>
          <select
            aria-label="Sort projects"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as ProjectSort)}
            className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:w-auto sm:min-w-60"
          >
            <option value="createdAt:desc">Date created, newest first</option>
            <option value="createdAt:asc">Date created, oldest first</option>
            <option value="dueDate:asc">Due date, soonest first</option>
            <option value="dueDate:desc">Due date, latest first</option>
            <option value="priority:desc">Priority, high first</option>
            <option value="priority:asc">Priority, low first</option>
          </select>
        </label>

        <div className="mt-6">
          {isPending && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"
                />
              ))}
            </div>
          )}

          {isError && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              Couldn&apos;t load projects. Try reloading the page.
            </p>
          )}

          {!isPending && !isError && projects?.length === 0 && (
            <Card className="text-center">
              <p className="text-slate-600 dark:text-slate-300">
                {view === "archived"
                  ? "No archived projects."
                  : view === "completed"
                    ? "No completed projects yet."
                    : view === "bin"
                      ? "The bin is empty."
                      : "No projects yet."}
              </p>
              {view === "completed" && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Projects appear here once every task is finished.
                </p>
              )}
              {view === "active" && canWrite && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Create your first project to start tracking tasks.
                </p>
              )}
            </Card>
          )}

          {!isPending && !isError && sortedProjects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sortedProjects.map((project) => (
                <Card key={project._id} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {view === "bin" ? (
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {project.name}
                        </span>
                      ) : (
                        <Link
                          to={`/orgs/${orgId}/projects/${project._id}`}
                          className="font-medium text-slate-800 hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-400"
                        >
                          {project.name}
                        </Link>
                      )}
                      <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {project.key}
                      </p>
                      <span
                        className={cn(
                          "mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                          project.priority === "high"
                            ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                            : project.priority === "medium"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                              : "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
                        )}
                      >
                        {project.priority}
                      </span>
                    </div>
                    {view === "bin" && project.purgeAt ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                          daysUntil(project.purgeAt) <= 3
                            ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                        )}
                        title={`Deleted for good on ${new Date(project.purgeAt).toLocaleDateString()}`}
                      >
                        {daysUntil(project.purgeAt) === 0
                          ? "Deletes today"
                          : `Deletes in ${daysUntil(project.purgeAt)} ${daysUntil(project.purgeAt) === 1 ? "day" : "days"}`}
                      </span>
                    ) : (
                      <Link
                        to={`/orgs/${orgId}/projects/${project._id}`}
                        aria-label={`Open ${project.name}`}
                        title="Open project"
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-700 dark:hover:bg-teal-950/40 dark:hover:text-teal-400"
                      >
                        Open
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </Link>
                    )}
                  </div>
                  {project.description && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      {project.description}
                    </p>
                  )}
                  {project.dueDate && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      Due{" "}
                      {formatDateInTimeZone(
                        project.dueDate,
                        org?.timeZone ?? "UTC",
                      )}
                    </p>
                  )}
                  <TaskCounts
                    project={project}
                    limit={
                      view === "active" || view === "completed"
                        ? activeTaskLimit
                        : null
                    }
                  />
                  {canWrite && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-700/60">
                      {view !== "bin" && (
                        <ActionButton onClick={() => openEditModal(project)}>
                          Edit
                        </ActionButton>
                      )}
                      {(view === "active" || view === "completed") && (
                        <ActionButton
                          onClick={() =>
                            setConfirmTarget({ project, action: "archive" })
                          }
                        >
                          Archive
                        </ActionButton>
                      )}
                      {view === "archived" && (
                        <ActionButton
                          tone="primary"
                          onClick={() => void unarchive(project)}
                          disabled={unarchiveProject.isPending}
                        >
                          Unarchive
                        </ActionButton>
                      )}
                      {view === "bin" ? (
                        <>
                          <ActionButton
                            tone="primary"
                            onClick={() => void restore(project)}
                            disabled={restoreProject.isPending}
                          >
                            Restore
                          </ActionButton>
                          <ActionButton
                            tone="danger"
                            onClick={() =>
                              setConfirmTarget({ project, action: "permanent" })
                            }
                          >
                            Delete permanently
                          </ActionButton>
                        </>
                      ) : (
                        <ActionButton
                          tone="danger"
                          onClick={() =>
                            setConfirmTarget({ project, action: "bin" })
                          }
                        >
                          Delete
                        </ActionButton>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={isCreateOpen}
        onClose={closeCreateModal}
        title={editingProject ? "Edit project" : "New project"}
      >
        <form
          onSubmit={(event) => void handleSubmit(onCreateSubmit)(event)}
          noValidate
          className="space-y-4"
        >
          <ErrorBanner message={formError} />

          <Field label="Name" htmlFor="name" error={errors.name?.message}>
            <input
              id="name"
              type="text"
              {...register("name")}
              className={inputStyles}
            />
          </Field>

          <Field label="Key" htmlFor="key" error={errors.key?.message}>
            <input
              id="key"
              type="text"
              placeholder="e.g. OPS"
              {...register("key")}
              readOnly={editingProject !== null}
              className={cn(inputStyles, "font-mono uppercase")}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            error={errors.description?.message}
          >
            <textarea
              id="description"
              rows={3}
              {...register("description")}
              className={inputStyles}
            />
          </Field>

          <Field label="Due date" htmlFor="projectDueDate">
            <input
              id="projectDueDate"
              type="date"
              {...register("dueDate")}
              className={inputStyles}
            />
          </Field>

          <Field label="Priority" htmlFor="projectPriority">
            <select
              id="projectPriority"
              {...register("priority")}
              className={inputStyles}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={closeCreateModal}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                createProject.isPending ||
                updateProject.isPending
              }
              loading={
                isSubmitting ||
                createProject.isPending ||
                updateProject.isPending
              }
              className="w-full sm:w-auto"
            >
              {isSubmitting ||
              createProject.isPending ||
              updateProject.isPending
                ? editingProject
                  ? "Saving…"
                  : "Creating…"
                : editingProject
                  ? "Save project"
                  : "Create project"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={confirmTarget ? CONFIRM_COPY[confirmTarget.action].title : ""}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {confirmTarget &&
            CONFIRM_COPY[confirmTarget.action].body(
              confirmTarget.project.name,
              retentionDays,
            )}
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmTarget(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmTarget?.action === "archive" ? "primary" : "danger"}
            onClick={() => void handleConfirm()}
            loading={isConfirming}
          >
            {confirmTarget ? CONFIRM_COPY[confirmTarget.action].button : ""}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function TabCount({
  value,
  selected,
}: {
  value: number | undefined;
  selected: boolean;
}) {
  if (value === undefined) return null;
  return (
    <span
      className={cn(
        "min-w-3.5 rounded-full px-0.5 py-px text-center text-[9px] font-semibold sm:min-w-[1.25rem] sm:px-1.5 sm:text-xs",
        selected
          ? "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300"
          : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
      )}
    >
      {value}
    </span>
  );
}

// Active (not done) tasks against the plan's per-project limit, plus the
// project's total. `limit` is null on an unlimited plan or an archived project.
function TaskCounts({
  project,
  limit,
}: {
  project: ProjectSummary;
  limit: number | null;
}) {
  const { activeTaskCount: active, taskCount: total } = project;
  const atLimit = limit !== null && active >= limit;
  const percent = limit ? Math.min(100, Math.round((active / limit) * 100)) : 0;

  return (
    <div className="mt-auto pt-4">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          <span
            className={cn(
              "font-semibold",
              atLimit
                ? "text-amber-700 dark:text-amber-300"
                : "text-slate-900 dark:text-slate-100",
            )}
          >
            {active}
          </span>
          {limit !== null && (
            <span className="text-slate-500 dark:text-slate-400">
              {" "}
              / {limit}
            </span>
          )}{" "}
          active {active === 1 && limit === null ? "task" : "tasks"}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {total} {total === 1 ? "task" : "tasks"} in total
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>To do {project.todoTaskCount}</span>
        <span>In progress {project.inProgressTaskCount}</span>
        <span>Completed {project.completedTaskCount}</span>
      </div>
      {limit !== null && (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
          role="progressbar"
          aria-label={`${active} of ${limit} active tasks`}
          aria-valuenow={active}
          aria-valuemin={0}
          aria-valuemax={limit}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              atLimit ? "bg-amber-500" : "bg-teal-500",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

const CONFIRM_COPY: Record<
  ConfirmAction,
  {
    title: string;
    button: string;
    body: (name: string, retentionDays: number) => string;
  }
> = {
  archive: {
    title: "Archive project?",
    button: "Archive",
    body: (name) =>
      `"${name}" moves to Archived. Its tasks stay readable, but no new tasks can be added. You can unarchive it any time.`,
  },
  bin: {
    title: "Move to bin?",
    button: "Move to bin",
    body: (name, days) =>
      `"${name}" and its tasks move to the bin and disappear from the app. You can restore it within ${days} days; after that it's deleted for good.`,
  },
  permanent: {
    title: "Delete permanently?",
    button: "Delete permanently",
    body: (name) =>
      `"${name}" and all of its tasks and updates will be deleted right away. This can't be undone.`,
  },
};

function ActionButton({
  tone = "neutral",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "neutral" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "font-medium hover:underline disabled:opacity-50",
        tone === "neutral" && "text-slate-500 dark:text-slate-400",
        tone === "primary" && "text-teal-700 dark:text-teal-400",
        tone === "danger" && "text-red-600 dark:text-red-400",
      )}
    />
  );
}

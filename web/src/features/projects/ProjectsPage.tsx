import { useState } from "react";
import {
  useAccountPaused,
  useGrowthBlocked,
  GROWTH_BLOCKED_HINT,
  PAUSED_HINT,
} from "@/features/billing/useAccountPaused";
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
import { MuteToggle } from "@/features/notifications/MuteToggle";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { ActivityFeed } from "@/features/tasks/ActivityFeed";
import { ViewTabs } from "@/components/ui/ViewTabs";
import { MoreMenu, MoreMenuItem } from "@/components/ui/MoreMenu";
import {
  compareLifecycleItems,
  defaultLifecycleSort,
  getLifecycleSortOptions,
  type LifecycleSort,
} from "@/lib/lifecycleSorting";
import {
  useLifecycleSortPreferences,
  useSaveLifecycleSortPreference,
} from "@/lib/lifecycleSortPreferences";
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
  useKeepPlanArchived,
  useUpdateProject,
} from "./queries";

const createProjectFormSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z][A-Z0-9]{1,5}$/,
      "Key must be 2-6 letters or numbers, starting with a letter",
    ),
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

const EMPTY_PROJECT_FORM: CreateProjectFormValues = {
  name: "",
  key: "",
  description: "",
  priority: "medium",
  dueDate: "",
};

type ConfirmAction = "archive" | "bin" | "permanent" | "keepArchived";

interface ConfirmTarget {
  project: Project;
  action: ConfirmAction;
}

type ProjectListView = ProjectView | "completed";
type ProjectSort = LifecycleSort;

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
  const paused = useAccountPaused();
  const growthBlocked = useGrowthBlocked();
  const navigate = useNavigate();
  const canWrite = useCan("project:write");
  const canComment = useCan("task:comment");
  const canRequestUpdates = useCan("task:request-update");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [projectRequestOpen, setProjectRequestOpen] = useState(false);
  const [view, setView] = useState<ProjectListView>("active");
  const sortPreferencesQuery = useLifecycleSortPreferences(orgId, "projects");
  const saveSortPreference = useSaveLifecycleSortPreference(orgId, "projects");

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
  const sortOptions = getLifecycleSortOptions(view);
  const savedSort = sortPreferencesQuery.data?.[view];
  const selectedSort = sortOptions.some((option) => option.value === savedSort)
    ? (savedSort as ProjectSort)
    : defaultLifecycleSort(view);
  const sortedProjects = [...(projects ?? [])].sort((left, right) =>
    compareLifecycleItems(left, right, selectedSort),
  );
  const counts = data?.counts ?? activeList.data?.counts;
  const activeProjectCount = activeList.data
    ? activeList.data.projects.length - completedProjects.length
    : undefined;
  const completedProjectCount = activeList.data
    ? completedProjects.length
    : undefined;
  const retentionDays = data?.binRetentionDays ?? 30;
  const projectsWithOpenTasks = (activeList.data?.projects ?? []).filter(
    (project) => project.activeTaskCount > 0,
  );

  const org = useOrgDetails(orgId).data;
  const activeTaskLimit = org ? PLAN_LIMITS[org.plan].activeTaskLimit : null;
  const atProjectLimit = org ? org.projectCount >= org.projectLimit : false;
  const createProject = useCreateProject(orgId);
  const updateProject = useUpdateProject(orgId);
  const archiveProject = useArchiveProject(orgId);
  const deleteProject = useDeleteProject(orgId);
  const unarchiveProject = useUnarchiveProject(orgId);
  const keepPlanArchived = useKeepPlanArchived(orgId, "project");
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
    defaultValues: EMPTY_PROJECT_FORM,
  });

  const closeCreateModal = () => {
    const wasEditing = editingProject !== null;
    setIsCreateOpen(false);
    setEditingProject(null);
    setFormError(null);
    if (wasEditing) reset(EMPTY_PROJECT_FORM);
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
        reset(EMPTY_PROJECT_FORM);
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
    if (editingProject) reset(EMPTY_PROJECT_FORM);
    setEditingProject(null);
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

  const showError = (error: unknown, projectName: string) => {
    const parsed = parseApiError(error);
    if (parsed.code === "PROJECT_LIMIT_REACHED") {
      toast.error("No free project slot", {
        description: `Upgrade your plan to restore "${projectName}" and use more active projects. You can also archive another project to free a slot.`,
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
      showError(error, project.name);
    }
  };

  const unarchive = async (project: Project) => {
    try {
      await unarchiveProject.mutateAsync(project._id);
      toast.success(`"${project.name}" is active again`);
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "TASK_LIMIT_REACHED") {
        toast.error(`"${project.name}" has too many open tasks`, {
          description:
            "Upgrade your plan to use more active tasks in this project, or finish some tasks before unarchiving it.",
          action: {
            label: "Settings",
            onClick: () => navigate(`/orgs/${orgId}/settings`),
          },
        });
        return;
      }
      showError(error, project.name);
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
      } else if (action === "keepArchived") {
        await keepPlanArchived.mutateAsync(project._id);
        toast.success(`"${project.name}" will stay archived`);
      } else {
        await deletePermanently.mutateAsync(project._id);
        toast.success(`Deleted "${project.name}" permanently`);
      }
    } catch (error) {
      showError(error, project.name);
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
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-2">
            <MuteToggle orgId={orgId} allProjects iconOnly />
            {canComment && (
              <Button
                variant="secondary"
                onClick={() => setProjectRequestOpen(true)}
                disabled={!projectsWithOpenTasks.length}
                title="Post an update, ask a question, or request updates from people on open tasks across active projects"
                className="min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
              >
                Update
              </Button>
            )}
            {canWrite && (
              <Button
                data-tour="projects-create"
                onClick={openCreateModal}
                disabled={paused || growthBlocked || atProjectLimit}
                title={
                  paused
                    ? PAUSED_HINT
                    : growthBlocked
                      ? GROWTH_BLOCKED_HINT
                      : atProjectLimit
                        ? `All ${org?.projectLimit} project slots on the ${PLAN_NAMES[org!.plan]} plan are in use. Archive or delete a project, or upgrade.`
                        : undefined
                }
                className="min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
              >
                New project
              </Button>
            )}
          </div>
        </div>

        <div data-tour="projects-tabs">
          <ViewTabs
            label="Project lists"
            className="mt-5"
            value={view}
            onChange={setView}
            tabs={VIEWS.map((tab) => ({
              ...tab,
              count:
                tab.value === "active"
                  ? activeProjectCount
                  : tab.value === "completed"
                    ? completedProjectCount
                    : counts?.[tab.value],
            }))}
          />
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

        <label className="mt-4 flex min-w-0 flex-col items-start gap-1.5 text-sm text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0">Sort projects</span>
          <select
            data-tour="projects-sort"
            aria-label="Sort projects"
            value={selectedSort}
            onChange={(event) =>
              saveSortPreference.mutate({
                view,
                sort: event.target.value as ProjectSort,
              })
            }
            className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:w-auto sm:min-w-60"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div data-tour="projects-first-card" className="mt-6">
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
                <Card
                  key={project._id}
                  className={cn(
                    "flex flex-col p-4",
                    view !== "bin" && "cursor-pointer",
                  )}
                  onClick={(event) => {
                    const target = event.target;
                    if (
                      target instanceof Element &&
                      target.closest(
                        "a, button, summary, input, select, textarea",
                      )
                    ) {
                      return;
                    }
                    if (view !== "bin") {
                      navigate(`/orgs/${orgId}/projects/${project._id}`);
                    }
                  }}
                >
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
                      {view === "archived" && (
                        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {project.archivedReason === "plan_limit"
                            ? "Archived by plan limit"
                            : "Manually archived"}
                        </span>
                      )}
                      <span
                        className={cn(
                          "mt-2 inline-flex self-start rounded-full px-2 py-0.5 text-xs font-medium capitalize",
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
                    <div className="flex shrink-0 items-start gap-1">
                      {view === "bin" && project.purgeAt && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
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
                      )}
                      {canWrite && (
                        <MoreMenu label={project.name}>
                          {view !== "bin" && (
                            <MoreMenuItem
                              onClick={() => openEditModal(project)}
                            >
                              Edit
                            </MoreMenuItem>
                          )}
                          {(view === "active" || view === "completed") && (
                            <MoreMenuItem
                              onClick={() =>
                                setConfirmTarget({ project, action: "archive" })
                              }
                            >
                              Archive
                            </MoreMenuItem>
                          )}
                          {view === "archived" && (
                            <>
                              <MoreMenuItem
                                onClick={() => void unarchive(project)}
                                disabled={unarchiveProject.isPending}
                              >
                                Unarchive
                              </MoreMenuItem>
                              {project.archivedReason === "plan_limit" && (
                                <MoreMenuItem
                                  onClick={() =>
                                    setConfirmTarget({
                                      project,
                                      action: "keepArchived",
                                    })
                                  }
                                >
                                  Keep archived
                                </MoreMenuItem>
                              )}
                            </>
                          )}
                          {view === "bin" ? (
                            <>
                              <MoreMenuItem
                                onClick={() => void restore(project)}
                                disabled={restoreProject.isPending}
                              >
                                Restore
                              </MoreMenuItem>
                              <MoreMenuItem
                                tone="danger"
                                onClick={() =>
                                  setConfirmTarget({
                                    project,
                                    action: "permanent",
                                  })
                                }
                              >
                                Delete permanently
                              </MoreMenuItem>
                            </>
                          ) : (
                            <MoreMenuItem
                              tone="danger"
                              onClick={() =>
                                setConfirmTarget({ project, action: "bin" })
                              }
                            >
                              Delete
                            </MoreMenuItem>
                          )}
                        </MoreMenu>
                      )}
                    </div>
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
                  <div>
                    <TaskCounts
                      project={project}
                      limit={
                        view === "active" || view === "completed"
                          ? activeTaskLimit
                          : null
                      }
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={projectRequestOpen}
        onClose={() => setProjectRequestOpen(false)}
        title="Update across active projects"
        size="lg"
      >
        <ActivityFeed
          orgId={orgId}
          scope={{
            kind: "project",
            id: projectsWithOpenTasks[0]?._id ?? "",
          }}
          workspaceProjectIds={projectsWithOpenTasks.map(
            (project) => project._id,
          )}
          canLead={canRequestUpdates}
          canContribute={!canRequestUpdates && canComment}
        />
      </Modal>

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
              placeholder="e.g. OPS or WEB2"
              maxLength={6}
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

          <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
            <Button
              type="submit"
              disabled={
                paused ||
                isSubmitting ||
                createProject.isPending ||
                updateProject.isPending
              }
              loading={
                isSubmitting ||
                createProject.isPending ||
                updateProject.isPending
              }
              className="w-full"
            >
              {isSubmitting ||
              createProject.isPending ||
              updateProject.isPending
                ? editingProject
                  ? "Saving…"
                  : "Creating…"
                : editingProject
                  ? "Save project"
                  : "Create Project"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full border-0 bg-transparent px-2 text-slate-500 shadow-none hover:bg-transparent dark:text-slate-400 dark:hover:bg-transparent"
              onClick={() => {
                if (editingProject) closeCreateModal();
                else {
                  reset(EMPTY_PROJECT_FORM);
                  setFormError(null);
                }
              }}
              disabled={
                isSubmitting ||
                createProject.isPending ||
                updateProject.isPending
              }
            >
              {editingProject ? "Cancel" : "Clear"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={
          confirmTarget
            ? confirmTarget.action === "keepArchived"
              ? "Keep this project archived?"
              : CONFIRM_COPY[confirmTarget.action].title
            : ""
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {confirmTarget &&
            (confirmTarget.action === "keepArchived"
              ? `This will keep ${confirmTarget.project.name} archived and remove it and its plan-archived tasks from the list of items that can be restored after a plan change.`
              : CONFIRM_COPY[confirmTarget.action].body(
                  confirmTarget.project.name,
                  retentionDays,
                ))}
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmTarget(null)}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={
              confirmTarget?.action === "archive" ||
              confirmTarget?.action === "keepArchived"
                ? "primary"
                : "danger"
            }
            onClick={() => void handleConfirm()}
            loading={isConfirming}
            className="w-full sm:w-auto"
          >
            {confirmTarget
              ? confirmTarget.action === "keepArchived"
                ? "Keep archived"
                : CONFIRM_COPY[confirmTarget.action].button
              : ""}
          </Button>
        </div>
      </Modal>
    </div>
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
  keepArchived: {
    title: "Keep this project archived?",
    button: "Keep archived",
    body: (name) =>
      `This will keep ${name} archived and remove it and its plan-archived tasks from the list of items that can be restored after a plan change.`,
  },
};

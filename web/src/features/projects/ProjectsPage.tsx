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
import type { Project } from "./api";
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useProjects,
} from "./queries";

const createProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, "Key must be 2-6 uppercase letters"),
  description: z.string().trim().max(500).optional(),
});

type CreateProjectFormValues = z.infer<typeof createProjectFormSchema>;

const CREATE_PROJECT_FIELDS = ["name", "key", "description"] as const;

interface ConfirmTarget {
  project: Project;
  action: "archive" | "delete";
}

export function ProjectsPage() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const canWrite = useCan("project:write");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const {
    data: projects,
    isPending,
    isError,
  } = useProjects(orgId, { archived: view === "archived" });
  const createProject = useCreateProject(orgId);
  const archiveProject = useArchiveProject(orgId);
  const deleteProject = useDeleteProject(orgId);

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
    setFormError(null);
    reset();
  };

  const onCreateSubmit = async (values: CreateProjectFormValues) => {
    setFormError(null);
    try {
      await createProject.mutateAsync(values);
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

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    const { project, action } = confirmTarget;

    try {
      if (action === "archive") {
        await archiveProject.mutateAsync(project._id);
      } else {
        await deleteProject.mutateAsync(project._id);
      }
      setConfirmTarget(null);
    } catch (error) {
      const parsed = parseApiError(error);
      toast.error(parsed.message);
      setConfirmTarget(null);
    }
  };

  return (
    <div className="bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Projects
          </h1>
          {canWrite && (
            <Button onClick={() => setIsCreateOpen(true)}>New project</Button>
          )}
        </div>

        <div className="mt-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setView("active")}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors",
              view === "active"
                ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
            )}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setView("archived")}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors",
              view === "archived"
                ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
            )}
          >
            Archived
          </button>
        </div>

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
                  : "No projects yet."}
              </p>
              {view === "active" && canWrite && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Create your first project to start tracking tasks.
                </p>
              )}
            </Card>
          )}

          {!isPending && !isError && projects && projects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <Card key={project._id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/orgs/${orgId}/projects/${project._id}`}
                        className="font-medium text-slate-800 hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-400"
                      >
                        {project.name}
                      </Link>
                      <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {project.key}
                      </p>
                    </div>
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
                  </div>
                  {project.description && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      {project.description}
                    </p>
                  )}
                  {canWrite && (
                    <div className="mt-3 flex gap-3 text-sm">
                      {view === "active" && (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmTarget({ project, action: "archive" })
                          }
                          className="text-slate-500 hover:underline dark:text-slate-400"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmTarget({ project, action: "delete" })
                        }
                        className="text-red-600 hover:underline dark:text-red-400"
                      >
                        Delete
                      </button>
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
        title="New project"
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

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={closeCreateModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create project"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={
          confirmTarget?.action === "delete"
            ? "Delete project?"
            : "Archive project?"
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {confirmTarget?.action === "delete"
            ? `This permanently deletes "${confirmTarget.project.name}" and all of its tasks. This can't be undone.`
            : `"${confirmTarget?.project.name}" will be hidden from the active projects list. You can still view it under archived projects.`}
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
            variant={confirmTarget?.action === "delete" ? "danger" : "primary"}
            onClick={() => void handleConfirm()}
            loading={archiveProject.isPending || deleteProject.isPending}
          >
            {confirmTarget?.action === "delete" ? "Delete" : "Archive"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { Modal } from "@/components/Modal";
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

  const { data: projects, isPending, isError } = useProjects(orgId);
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
    <div className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Projects</h1>
          {canWrite && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white"
            >
              New project
            </button>
          )}
        </div>

        <div className="mt-6">
          {isPending && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-lg bg-slate-200"
                />
              ))}
            </div>
          )}

          {isError && (
            <p className="rounded bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn&apos;t load projects. Try reloading the page.
            </p>
          )}

          {!isPending && !isError && projects?.length === 0 && (
            <div className="rounded-lg bg-white p-8 text-center shadow">
              <p className="text-slate-600">No projects yet.</p>
              {canWrite && (
                <p className="mt-1 text-sm text-slate-500">
                  Create your first project to start tracking tasks.
                </p>
              )}
            </div>
          )}

          {!isPending && !isError && projects && projects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <div
                  key={project._id}
                  className="rounded-lg bg-white p-4 shadow"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <Link
                        to={`/orgs/${orgId}/projects/${project._id}`}
                        className="font-medium text-slate-800 hover:underline"
                      >
                        {project.name}
                      </Link>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {project.key}
                      </p>
                    </div>
                  </div>
                  {project.description && (
                    <p className="mt-2 text-sm text-slate-600">
                      {project.description}
                    </p>
                  )}
                  {canWrite && (
                    <div className="mt-3 flex gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmTarget({ project, action: "archive" })
                        }
                        className="text-slate-500 hover:underline"
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmTarget({ project, action: "delete" })
                        }
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
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
          {formError && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-slate-700"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              {...register("name")}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">
                {errors.name.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="key"
              className="block text-sm font-medium text-slate-700"
            >
              Key
            </label>
            <input
              id="key"
              type="text"
              placeholder="e.g. OPS"
              {...register("key")}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono uppercase"
            />
            {errors.key && (
              <p className="mt-1 text-sm text-red-600">
                {errors.key.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-slate-700"
            >
              Description
            </label>
            <textarea
              id="description"
              rows={3}
              {...register("description")}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
            {errors.description && (
              <p className="mt-1 text-sm text-red-600">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeCreateModal}
              className="rounded px-4 py-2 text-sm font-medium text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSubmitting ? "Creating…" : "Create project"}
            </button>
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
        <p className="text-sm text-slate-600">
          {confirmTarget?.action === "delete"
            ? `This permanently deletes "${confirmTarget.project.name}" and all of its tasks. This can't be undone.`
            : `"${confirmTarget?.project.name}" will be hidden from the active projects list. You can still view it under archived projects.`}
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirmTarget(null)}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            className={
              confirmTarget?.action === "delete"
                ? "rounded bg-red-600 px-4 py-2 text-sm font-medium text-white"
                : "rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white"
            }
          >
            {confirmTarget?.action === "delete" ? "Delete" : "Archive"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

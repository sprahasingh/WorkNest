import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "@/features/dashboard/queries";
import { orgKeys } from "@/features/org/queries";
import {
  archiveProject,
  createProject,
  deleteProject,
  deleteProjectPermanently,
  restoreProject,
  unarchiveProject,
  getProject,
  listPlanArchivedRestoreTasks,
  listProjects,
  keepPlanArchived,
  updateProject,
  type CreateProjectInput,
  type ListProjectsParams,
  type UpdateProjectInput,
} from "./api";

export const projectKeys = {
  all: (orgId: string) => ["orgs", orgId, "projects"] as const,
  lists: (orgId: string) => [...projectKeys.all(orgId), "list"] as const,
  list: (orgId: string, params: ListProjectsParams = {}) =>
    [...projectKeys.lists(orgId), params] as const,
  detail: (orgId: string, projectId: string) =>
    [...projectKeys.all(orgId), "detail", projectId] as const,
};

export const planRestoreTaskKeys = {
  candidates: (orgId: string) =>
    [...projectKeys.all(orgId), "plan-restore-task-candidates"] as const,
};

export function refreshRestoreCandidates(
  queryClient: Pick<ReturnType<typeof useQueryClient>, "invalidateQueries">,
  orgId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: projectKeys.list(orgId, { view: "archived" }),
    }),
    queryClient.invalidateQueries({
      queryKey: planRestoreTaskKeys.candidates(orgId),
    }),
  ]);
}

export function usePlanArchivedRestoreTasks(orgId: string, enabled = true) {
  return useQuery({
    queryKey: planRestoreTaskKeys.candidates(orgId),
    queryFn: () => listPlanArchivedRestoreTasks(orgId),
    enabled,
  });
}

export function useProjects(
  orgId: string,
  params: ListProjectsParams = {},
  enabled = true,
) {
  return useQuery({
    queryKey: projectKeys.list(orgId, params),
    queryFn: () => listProjects(orgId, params),
    enabled,
  });
}

export function useProject(orgId: string, projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(orgId, projectId),
    queryFn: () => getProject(orgId, projectId),
  });
}

export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(orgId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
    },
  });
}

export function useUpdateProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      input,
    }: {
      projectId: string;
      input: UpdateProjectInput;
    }) => updateProject(orgId, projectId, input),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
      void queryClient.setQueryData(
        projectKeys.detail(orgId, project._id),
        project,
      );
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
    },
  });
}

export function useArchiveProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => archiveProject(orgId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
    },
  });
}

// Any change to a project's state refreshes project lists, the dashboard and
// the org's usage (bin moves free or take a project slot).
function useProjectStateMutation<T>(
  orgId: string,
  mutationFn: (projectId: string) => Promise<T>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
      void queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
    },
  });
}

// Moves a project to the bin.
export function useDeleteProject(orgId: string) {
  return useProjectStateMutation(orgId, (projectId) =>
    deleteProject(orgId, projectId),
  );
}

export function useUnarchiveProject(orgId: string) {
  return useProjectStateMutation(orgId, (projectId) =>
    unarchiveProject(orgId, projectId),
  );
}

export function useRestoreProject(orgId: string) {
  return useProjectStateMutation(orgId, (projectId) =>
    restoreProject(orgId, projectId),
  );
}

export function useKeepPlanArchived(orgId: string, kind: "project" | "task") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) =>
      keepPlanArchived(orgId, kind, resourceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) }),
        queryClient.invalidateQueries({
          queryKey: planRestoreTaskKeys.candidates(orgId),
        }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.all(orgId) }),
      ]);
    },
  });
}

export function useDeleteProjectPermanently(orgId: string) {
  return useProjectStateMutation(orgId, (projectId) =>
    deleteProjectPermanently(orgId, projectId),
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "@/features/dashboard/queries";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  type CreateProjectInput,
  type ListProjectsParams,
} from "./api";

export const projectKeys = {
  all: (orgId: string) => ["orgs", orgId, "projects"] as const,
  lists: (orgId: string) => [...projectKeys.all(orgId), "list"] as const,
  list: (orgId: string, params: ListProjectsParams = {}) =>
    [...projectKeys.lists(orgId), params] as const,
  detail: (orgId: string, projectId: string) =>
    [...projectKeys.all(orgId), "detail", projectId] as const,
};

export function useProjects(orgId: string, params: ListProjectsParams = {}) {
  return useQuery({
    queryKey: projectKeys.list(orgId, params),
    queryFn: () => listProjects(orgId, params),
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

export function useDeleteProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => deleteProject(orgId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
    },
  });
}

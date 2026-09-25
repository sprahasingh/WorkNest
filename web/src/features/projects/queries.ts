import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveProject,
  createProject,
  deleteProject,
  listProjects,
  type CreateProjectInput,
  type ListProjectsParams,
} from "./api";

export const projectKeys = {
  all: (orgId: string) => ["orgs", orgId, "projects"] as const,
  list: (orgId: string, params: ListProjectsParams = {}) =>
    [...projectKeys.all(orgId), "list", params] as const,
};

export function useProjects(orgId: string, params: ListProjectsParams = {}) {
  return useQuery({
    queryKey: projectKeys.list(orgId, params),
    queryFn: () => listProjects(orgId, params),
  });
}

export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(orgId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
    },
  });
}

export function useArchiveProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => archiveProject(orgId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
    },
  });
}

export function useDeleteProject(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => deleteProject(orgId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(orgId) });
    },
  });
}

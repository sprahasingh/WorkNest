import { apiClient } from "@/api/client";

export interface Project {
  _id: string;
  tenantId: string;
  name: string;
  key: string;
  description?: string;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  key: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

export interface ListProjectsParams {
  archived?: boolean;
}

export async function listProjects(
  orgId: string,
  params: ListProjectsParams = {},
): Promise<Project[]> {
  const response = await apiClient.get<{ projects: Project[] }>(
    `/orgs/${orgId}/projects`,
    {
      params:
        params.archived === undefined
          ? undefined
          : { archived: params.archived ? "true" : "false" },
    },
  );
  return response.data.projects;
}

export async function createProject(
  orgId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const response = await apiClient.post<{ project: Project }>(
    `/orgs/${orgId}/projects`,
    input,
  );
  return response.data.project;
}

export async function getProject(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const response = await apiClient.get<{ project: Project }>(
    `/orgs/${orgId}/projects/${projectId}`,
  );
  return response.data.project;
}

export async function updateProject(
  orgId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const response = await apiClient.patch<{ project: Project }>(
    `/orgs/${orgId}/projects/${projectId}`,
    input,
  );
  return response.data.project;
}

export async function archiveProject(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const response = await apiClient.post<{ project: Project }>(
    `/orgs/${orgId}/projects/${projectId}/archive`,
  );
  return response.data.project;
}

export async function deleteProject(
  orgId: string,
  projectId: string,
): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/projects/${projectId}`);
}

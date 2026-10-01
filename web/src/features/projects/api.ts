import { apiClient } from "@/api/client";

export interface Project {
  _id: string;
  tenantId: string;
  name: string;
  key: string;
  description?: string;
  dueDate: string | null;
  dueDateIsDateOnly?: boolean;
  reminderCycle?: number;
  archivedAt: string | null;
  // Set while the project is in the bin.
  deletedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// A project as the list returns it, with its task totals. Active means not
// done, the count the plan's per-project task limit is measured against.
export interface ProjectSummary extends Project {
  activeTaskCount: number;
  taskCount: number;
  // When a project in the bin will be deleted for good.
  purgeAt: string | null;
}

export interface ListProjectsResponse {
  projects: ProjectSummary[];
  // How many projects are active and archived, whichever list was asked for.
  counts: { active: number; archived: number; bin: number };
  // Days a project stays in the bin before it's deleted for good.
  binRetentionDays: number;
}

export interface CreateProjectInput {
  name: string;
  key: string;
  description?: string;
  dueDate?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  dueDate?: string | null;
}

export type ProjectView = "active" | "archived" | "bin";

export interface ListProjectsParams {
  view?: ProjectView;
}

export async function listProjects(
  orgId: string,
  params: ListProjectsParams = {},
): Promise<ListProjectsResponse> {
  const response = await apiClient.get<ListProjectsResponse>(
    `/orgs/${orgId}/projects`,
    { params: { view: params.view ?? "active" } },
  );
  return response.data;
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

export async function unarchiveProject(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const response = await apiClient.post<{ project: Project }>(
    `/orgs/${orgId}/projects/${projectId}/unarchive`,
  );
  return response.data.project;
}

// Moves the project to the bin, where it can be restored for 30 days.
export async function deleteProject(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const response = await apiClient.delete<{ project: Project }>(
    `/orgs/${orgId}/projects/${projectId}`,
  );
  return response.data.project;
}

export async function restoreProject(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const response = await apiClient.post<{ project: Project }>(
    `/orgs/${orgId}/projects/${projectId}/restore`,
  );
  return response.data.project;
}

export async function deleteProjectPermanently(
  orgId: string,
  projectId: string,
): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/projects/${projectId}/permanent`);
}

import { apiClient } from "@/api/client";

export const PLAN_RESTORE_BATCH_SIZE = 500;

export interface Project {
  _id: string;
  tenantId: string;
  name: string;
  key: string;
  description?: string;
  priority: ProjectPriority;
  dueDate: string | null;
  dueDateIsDateOnly?: boolean;
  reminderCycle?: number;
  archivedAt: string | null;
  archivedReason?: "plan_limit" | null;
  completedAt?: string | null;
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
  completedTaskCount: number;
  todoTaskCount: number;
  inProgressTaskCount: number;
  taskCount: number;
  // When a project in the bin will be deleted for good.
  purgeAt: string | null;
}

export interface PlanArchivedTaskCandidate {
  _id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  archivedAt: string;
}

export interface PlanArchivedRestoreResult {
  projects: Project[];
  tasks: { _id: string }[];
  skipped: { projects: number; tasks: number };
}

export type ProjectPriority = "low" | "medium" | "high";

export interface ListProjectsResponse {
  projects: ProjectSummary[];
  // Counts by lifecycle view. Active excludes completed projects.
  counts: { active: number; archived: number; bin: number };
  // Days a project stays in the bin before it's deleted for good.
  binRetentionDays: number;
}

export interface CreateProjectInput {
  name: string;
  key: string;
  description?: string;
  priority?: ProjectPriority;
  dueDate?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  priority?: ProjectPriority;
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

export async function restorePlanArchivedProjects(
  orgId: string,
  projectIds: string[],
  taskIds: string[] = [],
): Promise<PlanArchivedRestoreResult> {
  const response = await apiClient.post<PlanArchivedRestoreResult>(
    `/orgs/${orgId}/projects/restore-plan-archived`,
    { projectIds, taskIds },
  );
  return response.data;
}

export async function listPlanArchivedRestoreTasks(
  orgId: string,
): Promise<PlanArchivedTaskCandidate[]> {
  const response = await apiClient.get<{ tasks: PlanArchivedTaskCandidate[] }>(
    `/orgs/${orgId}/projects/restore-plan-archived/tasks`,
  );
  return response.data.tasks;
}

export async function keepPlanArchived(
  orgId: string,
  kind: "project" | "task",
  resourceId: string,
): Promise<void> {
  await apiClient.post(
    `/orgs/${orgId}/projects/keep-plan-archived/${kind}/${resourceId}`,
  );
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

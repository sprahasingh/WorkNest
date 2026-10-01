import { apiClient } from "@/api/client";
import type { Plan } from "@/api/auth";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type TaskView = "active" | "completed" | "archived" | "bin";
export type ActivityType = "update_request" | "update" | "question" | "reply";
export type TaskNotificationType =
  "task_assigned" | "task_completed" | "task_due_soon" | "task_overdue";

export interface Task {
  _id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  dueDate: string | null;
  dueDateIsDateOnly?: boolean;
  reminderCycle?: number;
  completedAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  purgeAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStats {
  activeCount: number;
  activeLimit: number | null;
  plan: Plan;
  assignedToMe: boolean;
}

export interface TaskActivity {
  _id: string;
  taskId: string | null;
  projectId: string;
  authorId: string;
  type: ActivityType;
  content?: string;
  createdAt: string;
  author: { _id: string; name: string; email: string } | null;
  // Present in a project's feed: which task the entry was posted on.
  task?: { _id: string; title: string } | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeIds?: string[];
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeIds?: string[] | null;
  dueDate?: string | null;
}

export interface CreateActivityInput {
  type: ActivityType;
  content?: string;
  mentionMemberIds?: string[];
  mentionRoles?: Array<"admin" | "manager" | "member" | "assignee">;
}

export interface ListTasksParams {
  view?: TaskView;
  sortBy?: "dueDate" | "createdAt";
  sortOrder?: "asc" | "desc";
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  mine?: true;
  cursor?: string;
  limit?: number;
}

export interface ListTasksResponse {
  items: Task[];
  nextCursor: string | null;
  // How many tasks match across every page, not just this one.
  total: number;
  binRetentionDays: number;
}

export async function listTasks(
  orgId: string,
  projectId: string,
  params: ListTasksParams = {},
): Promise<ListTasksResponse> {
  const response = await apiClient.get<ListTasksResponse>(
    `/orgs/${orgId}/projects/${projectId}/tasks`,
    { params },
  );
  return response.data;
}

export async function createTask(
  orgId: string,
  projectId: string,
  input: CreateTaskInput,
): Promise<Task> {
  const response = await apiClient.post<{ task: Task }>(
    `/orgs/${orgId}/projects/${projectId}/tasks`,
    input,
  );
  return response.data.task;
}

export async function getTask(orgId: string, taskId: string): Promise<Task> {
  const response = await apiClient.get<{ task: Task }>(
    `/orgs/${orgId}/tasks/${taskId}`,
  );
  return response.data.task;
}

export async function updateTask(
  orgId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const response = await apiClient.patch<{ task: Task }>(
    `/orgs/${orgId}/tasks/${taskId}`,
    input,
  );
  return response.data.task;
}

export async function archiveTask(
  orgId: string,
  taskId: string,
): Promise<Task> {
  const response = await apiClient.patch<{ task: Task }>(
    `/orgs/${orgId}/tasks/${taskId}/archive`,
  );
  return response.data.task;
}

export async function unarchiveTask(
  orgId: string,
  taskId: string,
): Promise<Task> {
  const response = await apiClient.patch<{ task: Task }>(
    `/orgs/${orgId}/tasks/${taskId}/unarchive`,
  );
  return response.data.task;
}

export async function restoreTask(
  orgId: string,
  taskId: string,
): Promise<Task> {
  const response = await apiClient.post<{ task: Task }>(
    `/orgs/${orgId}/tasks/${taskId}/restore`,
  );
  return response.data.task;
}

export async function deleteTask(orgId: string, taskId: string): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/tasks/${taskId}`);
}

export async function deleteTaskPermanently(
  orgId: string,
  taskId: string,
): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/tasks/${taskId}/permanent`);
}

export async function getTaskStats(
  orgId: string,
  projectId: string,
): Promise<TaskStats> {
  const response = await apiClient.get<TaskStats>(
    `/orgs/${orgId}/projects/${projectId}/tasks/stats`,
  );
  return response.data;
}

// Activity lives either on one task, or on the project as a whole (e.g. an
// update request sent to every assignee in the project).
export type ActivityScope =
  { kind: "task"; id: string } | { kind: "project"; id: string };

function activityPath(orgId: string, scope: ActivityScope): string {
  return scope.kind === "task"
    ? `/orgs/${orgId}/tasks/${scope.id}/activity`
    : `/orgs/${orgId}/projects/${scope.id}/activity`;
}

export async function listActivities(
  orgId: string,
  scope: ActivityScope,
): Promise<TaskActivity[]> {
  const response = await apiClient.get<{ activities: TaskActivity[] }>(
    activityPath(orgId, scope),
  );
  return response.data.activities;
}

export interface CreateActivityResult {
  activity: TaskActivity;
  notifiedCount?: number;
}

export async function createActivity(
  orgId: string,
  scope: ActivityScope,
  input: CreateActivityInput,
): Promise<CreateActivityResult> {
  const response = await apiClient.post<CreateActivityResult>(
    activityPath(orgId, scope),
    input,
  );
  return response.data;
}

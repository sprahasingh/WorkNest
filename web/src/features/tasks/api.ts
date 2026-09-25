import { apiClient } from "@/api/client";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  _id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export interface ListTasksParams {
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

export async function deleteTask(
  orgId: string,
  taskId: string,
): Promise<void> {
  await apiClient.delete(`/orgs/${orgId}/tasks/${taskId}`);
}

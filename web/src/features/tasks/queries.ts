import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/query-core";
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
  type CreateTaskInput,
  type ListTasksResponse,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskInput,
} from "./api";

export interface TaskFilters {
  assigneeId?: string;
  priority?: TaskPriority;
  mine?: true;
}

export const taskKeys = {
  all: (orgId: string, projectId: string) =>
    ["orgs", orgId, "projects", projectId, "tasks"] as const,
  list: (
    orgId: string,
    projectId: string,
    status: TaskStatus,
    filters: TaskFilters,
  ) => [...taskKeys.all(orgId, projectId), "list", status, filters] as const,
};

export function useTaskColumn(
  orgId: string,
  projectId: string,
  status: TaskStatus,
  filters: TaskFilters,
) {
  return useInfiniteQuery({
    queryKey: taskKeys.list(orgId, projectId, status, filters),
    queryFn: ({ pageParam }) =>
      listTasks(orgId, projectId, {
        ...filters,
        status,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateTask(
  orgId: string,
  projectId: string,
  filters: TaskFilters,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(orgId, projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: taskKeys.list(orgId, projectId, "todo", filters),
      });
    },
  });
}

export function useUpdateTask(orgId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string;
      input: UpdateTaskInput;
    }) => updateTask(orgId, taskId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: taskKeys.all(orgId, projectId),
      });
    },
  });
}

export function useDeleteTask(orgId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => deleteTask(orgId, taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: taskKeys.all(orgId, projectId),
      });
    },
  });
}

interface UpdateStatusContext {
  sourceKey: ReturnType<typeof taskKeys.list>;
  targetKey: ReturnType<typeof taskKeys.list>;
  previousSource: InfiniteData<ListTasksResponse> | undefined;
  previousTarget: InfiniteData<ListTasksResponse> | undefined;
}

export function useUpdateTaskStatus(
  orgId: string,
  projectId: string,
  filters: TaskFilters,
) {
  const queryClient = useQueryClient();

  return useMutation<
    Task,
    unknown,
    { task: Task; newStatus: TaskStatus },
    UpdateStatusContext
  >({
    mutationFn: ({ task, newStatus }) =>
      updateTask(orgId, task._id, { status: newStatus }),

    onMutate: async ({ task, newStatus }) => {
      const sourceKey = taskKeys.list(orgId, projectId, task.status, filters);
      const targetKey = taskKeys.list(orgId, projectId, newStatus, filters);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: sourceKey }),
        queryClient.cancelQueries({ queryKey: targetKey }),
      ]);

      const previousSource =
        queryClient.getQueryData<InfiniteData<ListTasksResponse>>(sourceKey);
      const previousTarget =
        queryClient.getQueryData<InfiniteData<ListTasksResponse>>(targetKey);

      queryClient.setQueryData<InfiniteData<ListTasksResponse>>(
        sourceKey,
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((t) => t._id !== task._id),
                })),
              }
            : old,
      );

      queryClient.setQueryData<InfiniteData<ListTasksResponse>>(
        targetKey,
        (old) => {
          const updatedTask: Task = { ...task, status: newStatus };

          if (!old || old.pages.length === 0) {
            return {
              pages: [{ items: [updatedTask], nextCursor: null }],
              pageParams: [undefined],
            };
          }

          const [firstPage, ...restPages] = old.pages;
          return {
            ...old,
            pages: [
              { ...firstPage, items: [updatedTask, ...firstPage.items] },
              ...restPages,
            ],
          };
        },
      );

      return { sourceKey, targetKey, previousSource, previousTarget };
    },

    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(context.sourceKey, context.previousSource);
      queryClient.setQueryData(context.targetKey, context.previousTarget);
    },

    onSettled: (_data, _error, _variables, context) => {
      if (!context) return;
      void queryClient.invalidateQueries({ queryKey: context.sourceKey });
      void queryClient.invalidateQueries({ queryKey: context.targetKey });
    },
  });
}

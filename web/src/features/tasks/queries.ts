import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/query-core";
import { dashboardKeys } from "@/features/dashboard/queries";
import {
  createTask,
  deleteTask,
  getTask,
  getTaskStats,
  listTasks,
  updateTask,
  listActivities,
  createActivity,
  type ActivityScope,
  type CreateActivityInput,
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
  stats: (orgId: string, projectId: string) =>
    [...taskKeys.all(orgId, projectId), "stats"] as const,
  detail: (orgId: string, taskId: string) =>
    ["orgs", orgId, "tasks", taskId] as const,
  activity: (orgId: string, scope: ActivityScope) =>
    ["orgs", orgId, scope.kind, scope.id, "activity"] as const,
};

// The board and its active-task counter refresh on the same beat so they
// never disagree about work teammates added or finished meanwhile.
const BOARD_REFRESH_MS = 30_000;

export function useTaskStats(orgId: string, projectId: string) {
  return useQuery({
    queryKey: taskKeys.stats(orgId, projectId),
    queryFn: () => getTaskStats(orgId, projectId),
    enabled: !!projectId,
    refetchInterval: BOARD_REFRESH_MS,
  });
}

export function useTask(orgId: string, taskId: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(orgId, taskId ?? ""),
    queryFn: () => getTask(orgId, taskId!),
    enabled: !!taskId,
    retry: false,
  });
}

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
    refetchInterval: BOARD_REFRESH_MS,
  });
}

export function useCreateTask(orgId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(orgId, projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: taskKeys.all(orgId, projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
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
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(orgId, task._id), task);
      void queryClient.invalidateQueries({
        queryKey: taskKeys.all(orgId, projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
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
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
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
                pages: old.pages.map((page, index) => ({
                  ...page,
                  items: page.items.filter((t) => t._id !== task._id),
                  total:
                    index === 0 ? Math.max(page.total - 1, 0) : page.total,
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
              pages: [{ items: [updatedTask], nextCursor: null, total: 1 }],
              pageParams: [undefined],
            };
          }

          const [firstPage, ...restPages] = old.pages;
          return {
            ...old,
            pages: [
              {
                ...firstPage,
                items: [updatedTask, ...firstPage.items],
                total: firstPage.total + 1,
              },
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
      void queryClient.invalidateQueries({
        queryKey: taskKeys.stats(orgId, projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all(orgId),
      });
    },
  });
}

export function useActivity(orgId: string, scope: ActivityScope | null) {
  return useQuery({
    queryKey: taskKeys.activity(orgId, scope ?? { kind: "task", id: "" }),
    queryFn: () => listActivities(orgId, scope!),
    enabled: !!scope,
    // Keep an open conversation current while others post to it.
    refetchInterval: 15_000,
  });
}

export function useCreateActivity(orgId: string, scope: ActivityScope) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateActivityInput) =>
      createActivity(orgId, scope, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: taskKeys.activity(orgId, scope),
      });
    },
  });
}

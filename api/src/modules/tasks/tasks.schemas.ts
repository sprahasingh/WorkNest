import { z } from "zod";

const objectIdRegex = /^[a-f\d]{24}$/i;

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeId: z.string().regex(objectIdRegex).optional(),
    dueDate: z.coerce.date().optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeId: z.string().regex(objectIdRegex).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z
  .object({
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeId: z.string().regex(objectIdRegex).optional(),
    mine: z.enum(["true"]).optional(),
    cursor: z.string().regex(objectIdRegex).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

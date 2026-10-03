import { z } from "zod";

const objectIdRegex = /^[a-f\d]{24}$/i;
const dueDateInputSchema = z.union([z.iso.date(), z.coerce.date()]);

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeIds: z.array(z.string().regex(objectIdRegex)).optional(),
    dueDate: dueDateInputSchema.optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeIds: z.array(z.string().regex(objectIdRegex)).nullable().optional(),
    dueDate: dueDateInputSchema.nullable().optional(),
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const TASK_VIEWS = ["active", "completed", "archived", "bin"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const listTasksQuerySchema = z
  .object({
    view: z.enum(TASK_VIEWS).optional(),
    sortBy: z
      .enum([
        "dueDate",
        "createdAt",
        "completedAt",
        "archivedAt",
        "deletedAt",
        "priority",
      ])
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeId: z.string().regex(objectIdRegex).optional(),
    mine: z.enum(["true"]).optional(),
    cursor: z
      .string()
      .regex(/^(?:[a-f\d]{24}|(?:\d{1,16}|null)(?:_[0-2])?_[a-f\d]{24})$/i)
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const taskCountsQuerySchema = z
  .object({
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeId: z.string().regex(objectIdRegex).optional(),
    mine: z.enum(["true"]).optional(),
  })
  .strict();

export type TaskCountsQuery = z.infer<typeof taskCountsQuerySchema>;

export const ACTIVITY_TYPES = [
  "update_request",
  "update",
  "question",
  "reply",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const createActivitySchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES),
    content: z.string().trim().max(2000).optional(),
    mentionMemberIds: z
      .array(z.string().regex(objectIdRegex))
      .max(20, "Mention at most 20 people at once")
      .default([]),
    mentionRoles: z
      .array(z.enum(["admin", "manager", "member", "assignee"]))
      .default([]),
    // The message being answered; required for replies.
    replyToId: z.string().regex(objectIdRegex).optional(),
  })
  .strict()
  .refine((input) => input.type === "update_request" || !!input.content, {
    path: ["content"],
    message: "Write a message before posting",
  })
  .refine((input) => (input.type === "reply") === !!input.replyToId, {
    path: ["replyToId"],
    message:
      "Replies need the message they answer, and only replies can have one",
  });

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

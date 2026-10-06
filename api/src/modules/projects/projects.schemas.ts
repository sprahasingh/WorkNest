import { z } from "zod";

// A date ("2026-10-04") or a full timestamp. A bare number is not accepted:
// it would quietly become a date in 1970.
const dueDateInputSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }).pipe(z.coerce.date()),
]);

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z][A-Z0-9]{1,5}$/,
        "Key must be 2-6 letters or numbers, starting with a letter",
      ),
    description: z.string().trim().max(500).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    dueDate: dueDateInputSchema.optional(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    dueDate: dueDateInputSchema.nullable().optional(),
  })
  .strict();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = z
  .object({
    archived: z.enum(["true", "false"]).optional(),
    view: z.enum(["active", "archived", "bin"]).optional(),
  })
  .strict();

export const restorePlanArchivedSchema = z
  .object({
    projectIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(500),
    taskIds: z
      .array(z.string().regex(/^[a-f\d]{24}$/i))
      .max(500)
      .default([]),
  })
  .strict();

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

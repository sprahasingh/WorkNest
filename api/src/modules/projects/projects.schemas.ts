import { z } from "zod";

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    key: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,6}$/),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = z
  .object({
    archived: z.enum(["true", "false"]).optional(),
  })
  .strict();

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

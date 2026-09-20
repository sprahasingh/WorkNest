import { z } from "zod";

export const updateOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
  })
  .strict();

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

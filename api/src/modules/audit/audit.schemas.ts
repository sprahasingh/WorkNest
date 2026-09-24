import { z } from "zod";

const objectIdRegex = /^[a-f\d]{24}$/i;

export const listAuditLogsQuerySchema = z
  .object({
    action: z.string().optional(),
    actorId: z.string().regex(objectIdRegex).optional(),
    entityType: z.string().optional(),
    cursor: z.string().regex(objectIdRegex).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

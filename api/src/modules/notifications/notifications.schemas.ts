import { z } from "zod";

const objectIdRegex = /^[a-f\d]{24}$/i;

export const markReadSchema = z
  .object({
    ids: z.array(z.string().regex(objectIdRegex)).max(100).optional(),
  })
  .strict();

export type MarkReadInput = z.infer<typeof markReadSchema>;

export const listNotificationsQuerySchema = z
  .object({
    status: z.enum(["unread", "all"]).optional(),
  })
  .strict();

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;

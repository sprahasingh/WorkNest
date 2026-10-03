import { z } from "zod";

const objectIdRegex = /^[a-f\d]{24}$/i;

export const markReadSchema = z
  .object({
    ids: z.array(z.string().regex(objectIdRegex)).max(100).optional(),
  })
  .strict();

export type MarkReadInput = z.infer<typeof markReadSchema>;

export const dismissNotificationsSchema = z
  .object({
    ids: z.array(z.string().regex(objectIdRegex)).min(1).max(100),
  })
  .strict();

export type DismissNotificationsInput = z.infer<
  typeof dismissNotificationsSchema
>;

export const listNotificationsQuerySchema = z
  .object({
    status: z.enum(["unread", "all"]).optional(),
  })
  .strict();

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;

export const setMuteSchema = z
  .object({
    projectId: z.string().regex(objectIdRegex).optional(),
    taskId: z.string().regex(objectIdRegex).optional(),
    muted: z.boolean(),
  })
  .strict()
  .refine((input) => !!input.projectId !== !!input.taskId, {
    message: "Choose a project or a task to mute",
  });

export type SetMuteInput = z.infer<typeof setMuteSchema>;

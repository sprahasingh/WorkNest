import { z } from "zod";
import { PLANS } from "../../constants/plans.js";
import { isValidTimeZone } from "../../lib/timezone.js";

export const createOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
  })
  .strict();

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    timeZone: z
      .string()
      .refine(isValidTimeZone, "Invalid IANA time zone")
      .optional(),
    // When the time zone changes: keep date-only due dates on the same
    // calendar day (the default) or leave them exactly where they are.
    moveDueDates: z.boolean().optional(),
    // Days to keep chat messages; null keeps them for good.
    chatRetentionDays: z
      .union([z.literal(90), z.literal(180), z.literal(365), z.null()])
      .optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.timeZone !== undefined ||
      input.chatRetentionDays !== undefined,
  )
  .strict();

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const changePlanSchema = z
  .object({
    plan: z.enum(PLANS),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

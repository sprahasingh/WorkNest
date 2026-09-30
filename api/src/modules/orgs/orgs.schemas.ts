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
  })
  .refine((input) => input.name !== undefined || input.timeZone !== undefined)
  .strict();

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const changePlanSchema = z
  .object({
    plan: z.enum(PLANS),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

import { z } from "zod";
import { PLANS } from "../../constants/plans.js";

export const updateOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
  })
  .strict();

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const changePlanSchema = z
  .object({
    plan: z.enum(PLANS),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

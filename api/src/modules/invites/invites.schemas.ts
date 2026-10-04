import { z } from "zod";
import { ROLES } from "../../constants/roles.js";
import { newPasswordSchema } from "../auth/auth.schemas.js";

export const createInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    role: z.enum(ROLES),
    // Replace a pending invite for the same email with a fresh link.
    replaceExisting: z.boolean().optional(),
  })
  .strict();

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const inviteSignupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    password: newPasswordSchema,
  })
  .strict();

export type InviteSignupInput = z.infer<typeof inviteSignupSchema>;

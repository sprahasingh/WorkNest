import { z } from "zod";
import { ROLES } from "../../constants/roles.js";

export const createInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    role: z.enum(ROLES),
  })
  .strict();

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const inviteSignupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(72),
  })
  .strict();

export type InviteSignupInput = z.infer<typeof inviteSignupSchema>;

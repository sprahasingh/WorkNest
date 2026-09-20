import { z } from "zod";
import { ROLES } from "../../constants/roles.js";

export const changeRoleSchema = z
  .object({
    role: z.enum(ROLES),
  })
  .strict();

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

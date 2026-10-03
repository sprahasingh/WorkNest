import { z } from "zod";
import { ROLES } from "../../constants/roles.js";

export const changeRoleSchema = z
  .object({
    role: z.enum(ROLES),
  })
  .strict();

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

// What to do with the meetings a person organizes when they go. Left out, the
// upcoming ones are cancelled.
export const removeMemberSchema = z
  .object({
    meetings: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("cancel") }).strict(),
        z
          .object({
            action: z.literal("handover"),
            userId: z.string().regex(/^[a-f\d]{24}$/i),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .optional();

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

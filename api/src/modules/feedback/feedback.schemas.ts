import { z } from "zod";

export const feedbackSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(5, "Please write a little more")
      .max(2000, "Please keep it under 2000 characters"),
    // Optional, so they can be answered.
    email: z
      .string()
      .trim()
      .email()
      .max(200)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    page: z.string().trim().max(300).optional(),
    // A field people never see. If something fills it in, it was a bot.
    website: z.string().max(200).optional(),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackSchema>;

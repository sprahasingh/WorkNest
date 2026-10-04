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
    // One screenshot as a data URL. The app shrinks it first; the route checks
    // what it really is and how big.
    screenshot: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
      .max(2_800_000)
      .optional(),
    // A field people never see. If something fills it in, it was a bot.
    website: z.string().max(200).optional(),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackSchema>;

import { z } from "zod";
import "dotenv/config";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    ACCESS_TOKEN_TTL: z.string().default("15m"),
    CLIENT_ORIGIN: z.string().url("CLIENT_ORIGIN must be a valid URL"),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    SMTP_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    SMTP_FROM: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
  })
  .superRefine((values, context) => {
    if (Boolean(values.SMTP_URL) !== Boolean(values.SMTP_FROM)) {
      context.addIssue({
        code: "custom",
        path: [values.SMTP_URL ? "SMTP_FROM" : "SMTP_URL"],
        message: "SMTP_URL and SMTP_FROM must be configured together",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

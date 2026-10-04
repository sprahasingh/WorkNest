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
    BREVO_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    BREVO_FROM: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    SMTP_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    SMTP_FROM: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    // Where in-app feedback is emailed. Leave it out and the feedback form
    // falls back to a plain email link.
    FEEDBACK_TO_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    CLOUDINARY_CLOUD_NAME: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    CLOUDINARY_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    CLOUDINARY_API_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    // Razorpay, for paid plan upgrades. Use test keys (rzp_test_...) to try the
    // whole flow with fake payments. Leave them out and upgrades stay
    // simulated, as they are in local development.
    RAZORPAY_KEY_ID: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    RAZORPAY_KEY_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    // Signs the webhook Razorpay calls after a payment, so a plan is still
    // upgraded if the browser is closed right after paying.
    RAZORPAY_WEBHOOK_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    // Multiplies every rate limit. For automated browser tests that sign up
    // many times from one address. Leave it at 1 anywhere real people connect.
    RATE_LIMIT_SCALE: z.coerce.number().min(1).max(1000).default(1),
    // How many proxies sit in front of the API. Behind Render alone it is 1.
    // If the web app reaches the API through Vercel's /api rewrite, it is 2,
    // otherwise every visitor looks like the same address to the rate limits.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    // Whether plan upgrades work without payments (no Razorpay keys). Handy
    // while developing; off by default in production, so a lost key can't turn
    // every paid plan free.
    ALLOW_SIMULATED_UPGRADES: z.preprocess(
      (value) =>
        value === "" || value === undefined ? undefined : value === "true",
      z.boolean().optional(),
    ),
    EMAIL_VERIFICATION_BYPASS_EMAILS: z.preprocess(
      (value) =>
        typeof value === "string"
          ? value
              .split(",")
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean)
          : [],
      z.array(z.string().email()),
    ),
  })
  .superRefine((values, context) => {
    if (Boolean(values.BREVO_API_KEY) !== Boolean(values.BREVO_FROM)) {
      context.addIssue({
        code: "custom",
        path: [values.BREVO_API_KEY ? "BREVO_FROM" : "BREVO_API_KEY"],
        message: "BREVO_API_KEY and BREVO_FROM must be configured together",
      });
    }

    const cloudinary = [
      values.CLOUDINARY_CLOUD_NAME,
      values.CLOUDINARY_API_KEY,
      values.CLOUDINARY_API_SECRET,
    ];
    if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["CLOUDINARY_CLOUD_NAME"],
        message:
          "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be configured together",
      });
    }

    if (
      Boolean(values.RAZORPAY_KEY_ID) !== Boolean(values.RAZORPAY_KEY_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: [
          values.RAZORPAY_KEY_ID ? "RAZORPAY_KEY_SECRET" : "RAZORPAY_KEY_ID",
        ],
        message:
          "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured together",
      });
    }

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

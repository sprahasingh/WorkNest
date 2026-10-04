import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { isCommonPassword } from "./commonPasswords.js";

export type PasswordProblem =
  "too-short" | "common" | "pattern" | "has-email" | "has-name";

export interface PasswordContext {
  email?: string;
  name?: string;
}

const MESSAGES: Record<PasswordProblem, string> = {
  "too-short": "Use at least 8 characters.",
  common:
    "That password is one of the most commonly used, so it is guessed first. Pick something harder to guess, like a few unrelated words.",
  pattern:
    "That password is a repeated or sequential pattern (like aaaaaaaa or 12345678), which is easy to guess. Mix in unrelated words or characters.",
  "has-email":
    "That password contains part of your email address. Anyone who knows you could try it, so pick something unrelated to you.",
  "has-name":
    "That password contains your name. Anyone who knows you could try it, so pick something unrelated to you.",
};

// "aaaaaaaa", "abababab", "12345678", "abcdefgh", "87654321".
function isPattern(password: string): boolean {
  const lower = password.toLowerCase();
  if (new Set(lower).size <= 2) return true;
  for (const unit of [2, 3, 4]) {
    if (
      lower.length % unit === 0 &&
      lower === lower.slice(0, unit).repeat(lower.length / unit)
    ) {
      return true;
    }
  }
  const steps = [...lower].map((char, index) =>
    index === 0 ? 0 : char.charCodeAt(0) - lower.charCodeAt(index - 1),
  );
  const rest = steps.slice(1);
  return rest.every((step) => step === 1) || rest.every((step) => step === -1);
}

function containsPersonal(password: string, context: PasswordContext) {
  const lower = password.toLowerCase();
  const local = context.email?.split("@")[0]?.toLowerCase() ?? "";
  // Short pieces like "al" would flag far too many innocent passwords.
  if (local.length >= 4 && lower.includes(local)) return "has-email" as const;
  const parts = (context.name ?? "")
    .toLowerCase()
    .split(/[\s.\-_]+/)
    .filter((part) => part.length >= 4);
  if (parts.some((part) => lower.includes(part))) return "has-name" as const;
  return null;
}

export function findPasswordProblem(
  password: string,
  context: PasswordContext = {},
): PasswordProblem | null {
  if (password.length < 8) return "too-short";
  if (isCommonPassword(password)) return "common";
  if (isPattern(password)) return "pattern";
  return containsPersonal(password, context);
}

// Demo accounts listed in EMAIL_VERIFICATION_BYPASS_EMAILS skip the password
// rules too, so shared demo logins can keep a simple password.
export function assertPasswordAllowed(
  password: string,
  context: PasswordContext,
  field = "password",
): void {
  if (
    context.email &&
    env.EMAIL_VERIFICATION_BYPASS_EMAILS.includes(context.email.toLowerCase())
  ) {
    return;
  }
  const problem = findPasswordProblem(password, context);
  if (!problem) return;
  throw new AppError(400, "VALIDATION_ERROR", MESSAGES[problem], [
    { path: [field], message: MESSAGES[problem] },
  ]);
}

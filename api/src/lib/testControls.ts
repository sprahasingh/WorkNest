import { env } from "../config/env.js";

// Test-only tools, such as moving a plan's end date, are for the demo and test
// accounts listed in EMAIL_VERIFICATION_BYPASS_EMAILS and nobody else.
export function isTestControlEmail(email: string | null | undefined): boolean {
  return Boolean(
    email && env.EMAIL_VERIFICATION_BYPASS_EMAILS.includes(email.toLowerCase()),
  );
}

// Mirrors the server's password rules so the form can explain a problem the
// moment it appears. The server has the last word, and skips these rules for
// demo accounts, so nothing here blocks the submit button.
const COMMON = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "12345678",
  "123456789",
  "1234567890",
  "12345678910",
  "123123123",
  "11111111",
  "00000000",
  "87654321",
  "987654321",
  "qwertyui",
  "qwerty123",
  "qwertyuiop",
  "qwerty12345",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "1qaz2wsx",
  "zaq12wsx",
  "asdfghjk",
  "asdfghjkl",
  "zxcvbnm1",
  "abcd1234",
  "abc12345",
  "abcdefgh",
  "iloveyou",
  "iloveyou1",
  "letmein1",
  "letmein123",
  "welcome1",
  "welcome123",
  "admin123",
  "administrator",
  "adminadmin",
  "changeme",
  "changeme123",
  "football",
  "baseball",
  "superman",
  "princess",
  "sunshine",
  "monkey123",
  "dragon123",
  "master123",
  "trustno1",
  "whatever",
  "starwars",
  "internet",
  "computer",
  "samsung1",
  "india123",
  "india@123",
  "mypassword",
  "mypassword1",
  "worknest",
  "worknest123",
  "worknest1",
  "test1234",
  "testing123",
  "user1234",
]);

// bcrypt on the server only reads the first 72 bytes. Accented letters and
// emoji take more than one byte each.
export const PASSWORD_TOO_LONG =
  "That password is too long. Use at most 72 bytes (accented letters and emoji count as more than one).";

export function passwordFitsLimit(password: string): boolean {
  return new TextEncoder().encode(password).length <= 72;
}

export type PasswordProblem =
  "too-short" | "common" | "pattern" | "has-email" | "has-name";

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
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
  const rest = [...lower]
    .map((char, index) =>
      index === 0 ? 0 : char.charCodeAt(0) - lower.charCodeAt(index - 1),
    )
    .slice(1);
  return rest.every((step) => step === 1) || rest.every((step) => step === -1);
}

export function findPasswordProblem(
  password: string,
  context: { email?: string; name?: string } = {},
): PasswordProblem | null {
  if (password.length < 8) return "too-short";
  if (COMMON.has(password.toLowerCase().replace(/[\s-]/g, ""))) return "common";
  if (isPattern(password)) return "pattern";
  const lower = password.toLowerCase();
  const local = context.email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) return "has-email";
  const parts = (context.name ?? "")
    .toLowerCase()
    .split(/[\s.\-_]+/)
    .filter((part) => part.length >= 4);
  if (parts.some((part) => lower.includes(part))) return "has-name";
  return null;
}

export type PasswordStrength = "weak" | "okay" | "strong";

// A rough guide, not a guarantee: length matters most, then variety.
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 8) return "weak";
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((test) =>
    test.test(password),
  ).length;
  if (password.length >= 14 || (password.length >= 11 && kinds >= 3)) {
    return "strong";
  }
  return password.length >= 10 || kinds >= 3 ? "okay" : "weak";
}

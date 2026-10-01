import { vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

interface VerificationEmail {
  recipient: string;
  verificationUrl: string;
  purpose: "registration" | "email-change" | "password-reset";
}

interface InvitationEmail {
  recipient: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
}

const emailCapture = vi.hoisted(() => ({
  sent: [] as VerificationEmail[],
  invitations: [] as InvitationEmail[],
}));
const sentVerificationEmails = emailCapture.sent;
let nextTestIp = 1;

function testIp(app: Express, forwardedFor?: string): string {
  app.set("trust proxy", 1);
  return forwardedFor ?? `198.51.100.${nextTestIp++}`;
}

vi.mock("../src/lib/email.js", () => ({
  isEmailDeliveryConfigured: () => true,
  sendVerificationEmail: vi.fn(
    async (
      recipient: string,
      verificationUrl: string,
      purpose: VerificationEmail["purpose"],
    ) => {
      emailCapture.sent.push({ recipient, verificationUrl, purpose });
    },
  ),
  sendPasswordResetEmail: vi.fn(async (recipient: string, resetUrl: string) => {
    emailCapture.sent.push({
      recipient,
      verificationUrl: resetUrl,
      purpose: "password-reset",
    });
  }),
  sendInviteEmail: vi.fn(
    async (
      recipient: string,
      organizationName: string,
      role: string,
      inviteUrl: string,
    ) => {
      emailCapture.invitations.push({
        recipient,
        organizationName,
        role,
        inviteUrl,
      });
    },
  ),
}));

export function takeVerificationToken(
  recipient: string,
  purpose: Exclude<VerificationEmail["purpose"], "password-reset">,
): string {
  const index = sentVerificationEmails.findLastIndex(
    (email) => email.recipient === recipient && email.purpose === purpose,
  );
  if (index < 0) {
    throw new Error(
      `No ${purpose} verification email was sent to ${recipient}`,
    );
  }
  const [email] = sentVerificationEmails.splice(index, 1);
  const token = new URL(email!.verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Verification email did not contain a token");
  return token;
}

export function takePasswordResetToken(recipient: string): string {
  const index = sentVerificationEmails.findLastIndex(
    (email) =>
      email.recipient === recipient && email.purpose === "password-reset",
  );
  if (index < 0) {
    throw new Error(`No password reset email was sent to ${recipient}`);
  }
  const [email] = sentVerificationEmails.splice(index, 1);
  const token = new URL(email!.verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Password reset email did not contain a token");
  return token;
}

export function takeInvitationEmail(recipient: string): InvitationEmail {
  const index = emailCapture.invitations.findLastIndex(
    (email) => email.recipient === recipient,
  );
  if (index < 0) {
    throw new Error(`No invitation email was sent to ${recipient}`);
  }
  return emailCapture.invitations.splice(index, 1)[0]!;
}

export function takeInvitationToken(recipient: string): string {
  const token = new URL(takeInvitationEmail(recipient).inviteUrl).pathname
    .split("/")
    .at(-1);
  if (!token) throw new Error("Invitation email did not contain a token");
  return token;
}

export async function registerAndVerify(
  app: Express,
  input: { name: string; email: string; password: string; orgName: string },
  forwardedFor?: string,
) {
  const clientIp = testIp(app, forwardedFor);
  let registration = request(app).post("/api/auth/register");
  registration = registration.set("X-Forwarded-For", clientIp);
  const response = await registration.send(input);
  if (response.status !== 202) return response;
  const token = takeVerificationToken(input.email, "registration");
  let verification = request(app).post("/api/auth/verify-registration");
  verification = verification.set("X-Forwarded-For", clientIp);
  return verification.send({ token });
}

export async function signupInviteAndVerify(
  app: Express,
  inviteToken: string,
  email: string,
  input: { name: string; password: string },
) {
  const clientIp = testIp(app);
  const pending = await request(app)
    .post(`/api/invites/${inviteToken}/signup`)
    .set("X-Forwarded-For", clientIp)
    .send(input);
  if (pending.status !== 202) return pending;
  const token = takeVerificationToken(email, "registration");
  return request(app)
    .post("/api/auth/verify-registration")
    .set("X-Forwarded-For", clientIp)
    .send({ token });
}

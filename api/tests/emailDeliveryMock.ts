import { vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

interface VerificationEmail {
  recipient: string;
  verificationUrl: string;
  purpose: "registration" | "email-change";
}

const emailCapture = vi.hoisted(() => ({
  sent: [] as VerificationEmail[],
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
}));

export function takeVerificationToken(
  recipient: string,
  purpose: VerificationEmail["purpose"],
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

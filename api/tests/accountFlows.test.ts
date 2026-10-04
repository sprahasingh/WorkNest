import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { PendingRegistration } from "../src/models/PendingRegistration.js";
import { User } from "../src/models/User.js";
import {
  countVerificationEmails,
  takeVerificationToken,
} from "./emailDeliveryMock.js";

const app = createApp();
app.set("trust proxy", 1);
let ipCounter = 1;
const ip = () => `203.0.113.${ipCounter++}`;

const register = (email: string, extra: object = {}, forwardedFor = ip()) =>
  request(app)
    .post("/api/auth/register")
    .set("X-Forwarded-For", forwardedFor)
    .send({
      name: "New Person",
      email,
      password: "password123",
      orgName: "New Org",
      ...extra,
    });

const status = (signupToken: string, forwardedFor = ip()) =>
  request(app)
    .post("/api/auth/registration-status")
    .set("X-Forwarded-For", forwardedFor)
    .send({ signupToken });

describe("signing in on the device that signed up", () => {
  it("waits, then signs in once the link is opened on any device", async () => {
    const email = "flow1@accounts.test";
    const registered = await register(email);
    expect(registered.status).toBe(202);
    const signupToken = registered.body.signupToken as string;
    expect(signupToken).toBeTruthy();

    // Not opened yet.
    const waiting = await status(signupToken);
    expect(waiting.body).toEqual({ status: "waiting" });

    // Opened on another device, with the password chosen at sign-up.
    const link = takeVerificationToken(email, "registration");
    await request(app)
      .post("/api/auth/verify-registration")
      .set("X-Forwarded-For", ip())
      .send({ token: link, password: "password123" })
      .expect(201);

    // The first device now gets its own session.
    const ready = await status(signupToken);
    expect(ready.body.status).toBe("verified");
    expect(ready.body.accessToken).toBeTruthy();
    expect(String(ready.headers["set-cookie"])).toContain("refresh");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ready.body.accessToken}`);
    expect(me.body.user.email).toBe(email);

    // It works once only.
    const again = await status(signupToken);
    expect(again.body).toEqual({ status: "expired" });
  });

  it("does not sign in anyone who doesn't hold the secret", async () => {
    const email = "flow2@accounts.test";
    await register(email);
    const link = takeVerificationToken(email, "registration");
    await request(app)
      .post("/api/auth/verify-registration")
      .set("X-Forwarded-For", ip())
      .send({ token: link, password: "password123" })
      .expect(201);
    const guess = await status("x".repeat(43));
    expect(guess.body).toEqual({ status: "expired" });
  });

  it("reports an expired sign-up", async () => {
    const email = "flow3@accounts.test";
    const registered = await register(email);
    await PendingRegistration.collection.updateOne(
      { email },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const result = await status(registered.body.signupToken);
    expect(result.body).toEqual({ status: "expired" });
  });
});

describe("resending the verification link", () => {
  it("replaces the old link with a new one", async () => {
    const email = "resend1@accounts.test";
    const registered = await register(email);
    const oldLink = takeVerificationToken(email, "registration");
    // The first send happened a moment ago, so it must cool down first.
    await PendingRegistration.collection.updateOne(
      { email },
      { $set: { lastSentAt: new Date(Date.now() - 2 * 60 * 1000) } },
    );

    const resent = await request(app)
      .post("/api/auth/resend-verification")
      .set("X-Forwarded-For", ip())
      .send({ email });
    expect(resent.status).toBe(202);
    const newLink = takeVerificationToken(email, "registration");
    expect(newLink).not.toBe(oldLink);

    const withOld = await request(app)
      .post("/api/auth/verify-registration")
      .set("X-Forwarded-For", ip())
      .send({ token: oldLink, password: "password123" });
    expect(withOld.status).toBe(400);
    await request(app)
      .post("/api/auth/verify-registration")
      .set("X-Forwarded-For", ip())
      .send({ token: newLink, password: "password123" })
      .expect(201);
    expect(registered.body.signupToken).toBeTruthy();
  });

  it("holds back a second send within a minute", async () => {
    const email = "resend2@accounts.test";
    await register(email);
    const before = countVerificationEmails(email, "registration");
    await request(app)
      .post("/api/auth/resend-verification")
      .set("X-Forwarded-For", ip())
      .send({ email })
      .expect(202);
    expect(countVerificationEmails(email, "registration")).toBe(before);
  });

  it("answers the same way when nobody signed up with that email", async () => {
    const before = countVerificationEmails(
      "nobody@accounts.test",
      "registration",
    );
    const res = await request(app)
      .post("/api/auth/resend-verification")
      .set("X-Forwarded-For", ip())
      .send({ email: "nobody@accounts.test" });
    expect(res.status).toBe(202);
    expect(
      countVerificationEmails("nobody@accounts.test", "registration"),
    ).toBe(before);
  });
});

describe("resending an email change link", () => {
  async function pendingChange(domain: string) {
    const email = `owner@${domain}`;
    await register(email);
    const link = takeVerificationToken(email, "registration");
    const verified = await request(app)
      .post("/api/auth/verify-registration")
      .set("X-Forwarded-For", ip())
      .send({ token: link, password: "password123" });
    const token = verified.body.accessToken as string;
    const newEmail = `new@${domain}`;
    await request(app)
      .post("/api/auth/me/email-change")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Forwarded-For", ip())
      .send({ email: newEmail, currentPassword: "password123" })
      .expect(202);
    return { token, newEmail, email };
  }

  it("needs a minute between sends, then replaces the link", async () => {
    const { token, newEmail, email } = await pendingChange("change.test");
    const first = takeVerificationToken(newEmail, "email-change");

    const tooSoon = await request(app)
      .post("/api/auth/me/email-change/resend")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Forwarded-For", ip());
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe("RESEND_TOO_SOON");

    // A minute and a bit later (the link had an hour to live when sent).
    await User.collection.updateOne(
      { email },
      { $set: { emailChangeExpiresAt: new Date(Date.now() + 58 * 60 * 1000) } },
    );
    const ok = await request(app)
      .post("/api/auth/me/email-change/resend")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Forwarded-For", ip());
    expect(ok.status).toBe(200);
    expect(ok.body.user.pendingEmail).toBe(newEmail);
    const second = takeVerificationToken(newEmail, "email-change");
    expect(second).not.toBe(first);
  });

  it("says so when there is nothing to resend", async () => {
    const email = "plain@change.test";
    await register(email);
    const link = takeVerificationToken(email, "registration");
    const verified = await request(app)
      .post("/api/auth/verify-registration")
      .set("X-Forwarded-For", ip())
      .send({ token: link, password: "password123" });
    const res = await request(app)
      .post("/api/auth/me/email-change/resend")
      .set("Authorization", `Bearer ${verified.body.accessToken}`)
      .set("X-Forwarded-For", ip());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_PENDING_EMAIL_CHANGE");
  });
});

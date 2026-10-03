import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  registerAndVerify,
  takePasswordResetToken,
  takeVerificationToken,
} from "./emailDeliveryMock.js";
import { User } from "../src/models/User.js";
import { Organization } from "../src/models/Organization.js";
import { Session } from "../src/models/Session.js";
import { Membership } from "../src/models/Membership.js";
import { env } from "../src/config/env.js";

const app = createApp();

describe("auth flow", () => {
  it("creates a standalone user account without an organization", async () => {
    const verification = await registerAndVerify(app, {
      accountType: "user",
      name: "Standalone User",
      email: "standalone@example.com",
      password: "password123",
    });

    expect(verification.status).toBe(201);
    const user = await User.findOne({ email: "standalone@example.com" });
    expect(user).not.toBeNull();
    expect(
      await Membership.countDocuments({ userId: user?._id }).setOptions({
        skipTenant: true,
      }),
    ).toBe(0);
    expect(
      await Organization.countDocuments({ createdBy: user?._id }).setOptions({
        skipTenant: true,
      }),
    ).toBe(0);
  });

  it("registers, logs in, and fetches the current user", async () => {
    const registerRes = await registerAndVerify(app, {
      name: "Test User",
      email: "test@example.com",
      password: "password123",
      orgName: "Test Org",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.accessToken).toBeDefined();

    const loginRes = await request(app).post("/api/auth/login").send({
      email: "test@example.com",
      password: "password123",
    });

    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.accessToken as string;

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("test@example.com");
    expect(meRes.body.user.passwordHash).toBeUndefined();
  });

  it("rejects login with a wrong password", async () => {
    await registerAndVerify(app, {
      name: "Test User",
      email: "test@example.com",
      password: "password123",
      orgName: "Test Org",
    });

    const res = await request(app).post("/api/auth/login").send({
      email: "test@example.com",
      password: "wrongpassword",
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("resets a password with a one-time email token", async () => {
    await registerAndVerify(app, {
      name: "Reset User",
      email: "reset@example.com",
      password: "password123",
      orgName: "Reset Org",
    });

    const requestReset = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "reset@example.com" });
    expect(requestReset.status).toBe(200);
    expect(requestReset.body.message).toContain("Password reset email sent");

    const token = takePasswordResetToken("reset@example.com");
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "newpassword123" });
    expect(reset.status).toBe(200);
    expect(await Session.countDocuments({ revokedAt: null })).toBe(0);

    const oldPasswordLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "reset@example.com", password: "password123" });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "reset@example.com", password: "newpassword123" });
    expect(newPasswordLogin.status).toBe(200);

    const reusedToken = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "anotherpassword" });
    expect(reusedToken.status).toBe(400);
    expect(reusedToken.body.error.code).toBe("PASSWORD_RESET_INVALID");
  });

  it("returns an account-not-found error for an unknown password reset email", async () => {
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "unknown@example.com" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ACCOUNT_NOT_FOUND");
    expect(response.body.error.message).toContain("No account was found");
  });

  it("rotates the refresh token, tolerates a second tab, and fails on later reuse", async () => {
    await registerAndVerify(app, {
      name: "Test User",
      email: "test@example.com",
      password: "password123",
      orgName: "Test Org",
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      email: "test@example.com",
      password: "password123",
    });

    const originalCookie = loginRes.headers["set-cookie"][0] as string;

    const refreshRes = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", originalCookie);

    expect(refreshRes.status).toBe(200);
    const newCookie = refreshRes.headers["set-cookie"][0] as string;
    expect(newCookie).not.toBe(originalCookie);

    // A second tab refreshing with the old cookie a moment later is fine.
    const otherTab = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", originalCookie);
    expect(otherTab.status).toBe(200);

    // Reusing it well after the grace window means it was stolen.
    await Session.updateMany(
      { revokedAt: { $ne: null } },
      { revokedAt: new Date(Date.now() - 60_000) },
    );

    const reuseRes = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", originalCookie);

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    const cascadeRes = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", newCookie);

    expect(cascadeRes.status).toBe(401);
  });

  it("does not create an account or organization before email verification", async () => {
    const pending = await request(app).post("/api/auth/register").send({
      name: "Pending User",
      email: "pending@example.com",
      password: "password123",
      orgName: "Pending Org",
    });

    expect(pending.status).toBe(202);
    expect(await User.findOne({ email: "pending@example.com" })).toBeNull();
    expect(await Organization.findOne({ name: "Pending Org" })).toBeNull();

    const token = takeVerificationToken("pending@example.com", "registration");
    const verified = await request(app)
      .post("/api/auth/verify-registration")
      .send({ token });
    expect(verified.status).toBe(201);

    const user = await User.findOne({ email: "pending@example.com" });
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await Organization.findOne({ name: "Pending Org" })).not.toBeNull();

    const reused = await request(app)
      .post("/api/auth/verify-registration")
      .send({ token });
    expect(reused.status).toBe(400);
  });

  it("skips email verification only for configured addresses", async () => {
    const originalBypassEmails = env.EMAIL_VERIFICATION_BYPASS_EMAILS;
    env.EMAIL_VERIFICATION_BYPASS_EMAILS = ["dummy@example.com"];

    try {
      const response = await request(app).post("/api/auth/register").send({
        name: "Dummy User",
        email: "dummy@example.com",
        password: "password123",
        orgName: "Dummy Org",
      });

      expect(response.status).toBe(201);
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.verificationRequired).toBe(false);

      const user = await User.findOne({ email: "dummy@example.com" });
      expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
      expect(await Organization.findOne({ name: "Dummy Org" })).not.toBeNull();
    } finally {
      env.EMAIL_VERIFICATION_BYPASS_EMAILS = originalBypassEmails;
    }
  });
});

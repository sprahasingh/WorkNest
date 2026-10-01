import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  registerAndVerify,
  takeVerificationToken,
} from "./emailDeliveryMock.js";
import { User } from "../src/models/User.js";
import { Organization } from "../src/models/Organization.js";

const app = createApp();

describe("auth flow", () => {
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

  it("rotates the refresh token and fails on old-cookie reuse", async () => {
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
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();

describe("first-run tour", () => {
  it("is unseen for a new account and seen once marked, per account", async () => {
    const { admin, addMember } = await setupOrg(app, "tour.test");
    const sam = await addMember("sam");

    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(before.body.user.onboardingSeenAt).toBeNull();

    const marked = await request(app)
      .post("/api/auth/me/onboarding")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(marked.status).toBe(200);
    expect(marked.body.user.onboardingSeenAt).not.toBeNull();

    // It is remembered on the account, so any device sees the same thing.
    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(after.body.user.onboardingSeenAt).toBe(
      marked.body.user.onboardingSeenAt,
    );

    // Someone else's account is untouched.
    const others = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${sam.token}`);
    expect(others.body.user.onboardingSeenAt).toBeNull();
  });

  it("keeps the first time if it is marked again", async () => {
    const { admin } = await setupOrg(app, "tour2.test");
    const first = await request(app)
      .post("/api/auth/me/onboarding")
      .set("Authorization", `Bearer ${admin.token}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await request(app)
      .post("/api/auth/me/onboarding")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(second.status).toBe(200);
    expect(second.body.user.onboardingSeenAt).toBe(
      first.body.user.onboardingSeenAt,
    );
  });

  it("needs a signed-in account", async () => {
    await request(app).post("/api/auth/me/onboarding").expect(401);
  });
});

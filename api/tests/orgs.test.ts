import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

async function registerUser() {
  const res = await request(app).post("/api/auth/register").send({
    name: "Test User",
    email: "test@example.com",
    password: "password123",
    orgName: "First Org",
  });
  return res.body.accessToken as string;
}

describe("POST /api/orgs", () => {
  it("creates a second organization and makes the caller its admin", async () => {
    const accessToken = await registerUser();

    const createRes = await request(app)
      .post("/api/orgs")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Second Org" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.organization.name).toBe("Second Org");
    expect(createRes.body.organization.plan).toBe("free");

    const newOrgId = createRes.body.organization.id as string;

    const getRes = await request(app)
      .get(`/api/orgs/${newOrgId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.organization.id).toBe(newOrgId);

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(meRes.body.memberships).toHaveLength(2);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/orgs")
      .send({ name: "No Auth Org" });

    expect(res.status).toBe(401);
  });

  it("rejects a name shorter than 2 characters", async () => {
    const accessToken = await registerUser();

    const res = await request(app)
      .post("/api/orgs")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "A" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";

const app = createApp();

async function registerAndGetOrg(email: string, orgName: string) {
  const res = await request(app).post("/api/auth/register").send({
    name: "Test User",
    email,
    password: "password123",
    orgName,
  });

  const accessToken = res.body.accessToken as string;

  const meRes = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);

  const orgId = meRes.body.memberships[0].tenantId.id as string;

  return { accessToken, orgId };
}

describe("invite seat limits under concurrency", () => {
  it("allows exactly one success when 10 concurrent invites compete for 1 remaining seat", async () => {
    const { accessToken, orgId } = await registerAndGetOrg(
      "seat-race-admin@example.com",
      "Seat Race Org",
    );

    await Organization.findByIdAndUpdate(orgId, { seatLimit: 2 });

    const requests = Array.from({ length: 10 }, (_, i) =>
      request(app)
        .post(`/api/orgs/${orgId}/invites`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ email: `racer-${i}@example.com`, role: "member" }),
    );

    const results = await Promise.all(requests);

    const successes = results.filter((r) => r.status === 201);
    const failures = results.filter((r) => r.status === 409);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(9);
    expect(
      failures.every((r) => r.body.error.code === "SEAT_LIMIT_REACHED"),
    ).toBe(true);

    const org = await Organization.findById(orgId);
    expect(org!.seatsUsed).toBe(org!.seatLimit);
  });

  it("blocks a downgrade when current usage exceeds the target plan's limits", async () => {
    const { accessToken, orgId } = await registerAndGetOrg(
      "downgrade-admin@example.com",
      "Downgrade Org",
    );

    await Organization.findByIdAndUpdate(orgId, {
      plan: "pro",
      seatLimit: 25,
      projectLimit: 50,
      seatsUsed: 6,
    });

    const res = await request(app)
      .post(`/api/orgs/${orgId}/plan`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ plan: "free" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_DOWNGRADE_BLOCKED");

    const org = await Organization.findById(orgId);
    expect(org!.plan).toBe("pro");
  });
});

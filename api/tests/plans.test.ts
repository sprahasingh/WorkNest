import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { syncPlanLimits } from "../src/db/migrations.js";
import { registerAndVerify } from "./emailDeliveryMock.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const res = await registerAndVerify(app, {
    name: "Admin User",
    email,
    password: "password123",
    orgName,
  });
  const accessToken = res.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
    orgId: me.body.memberships[0].tenantId.id as string,
    userId: me.body.user.id as string,
  };
}

async function createProject(orgId: string, token: string, key: string) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${key}`, key });
  return res.body.project._id as string;
}

async function createTask(
  orgId: string,
  projectId: string,
  token: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

describe("plans", () => {
  it("applies each plan's limits and blocks downgrades that active tasks would break", async () => {
    const admin = await registerOrg("plans-admin@example.com", "Plans Org");
    const base = `/api/orgs/${admin.orgId}`;
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "PLN",
    );

    const toPremium = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "premium" });
    expect(toPremium.status).toBe(200);
    expect(toPremium.body.organization).toMatchObject({
      plan: "premium",
      seatLimit: 100,
      projectLimit: 50,
    });

    for (let i = 0; i < 11; i++) {
      const created = await createTask(
        admin.orgId,
        projectId,
        admin.accessToken,
        { title: `Busy ${i}` },
      );
      expect(created.status).toBe(201);
    }
    const premiumStats = await request(app)
      .get(`${base}/projects/${projectId}/tasks/stats`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(premiumStats.body).toMatchObject({
      plan: "premium",
      activeLimit: null,
      activeCount: 11,
    });

    const toFree = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "free" });
    expect(toFree.status).toBe(409);
    expect(toFree.body.error.code).toBe("PLAN_DOWNGRADE_BLOCKED");
    expect(toFree.body.error.details[0]).toMatchObject({
      projectsOverTaskLimit: 1,
      targetActiveTaskLimit: 10,
    });

    const toPro = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "pro" });
    expect(toPro.status).toBe(200);
    expect(toPro.body.organization).toMatchObject({
      plan: "pro",
      seatLimit: 30,
      projectLimit: 25,
    });

    const unknownPlan = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "enterprise" });
    expect(unknownPlan.status).toBe(400);
  });

  it("brings organizations with outdated limits up to date on startup", async () => {
    const admin = await registerOrg("plans-sync@example.com", "Sync Org");
    await Organization.findByIdAndUpdate(admin.orgId, {
      plan: "pro",
      seatLimit: 25,
      projectLimit: 50,
    });

    await syncPlanLimits();

    const org = await Organization.findById(admin.orgId);
    expect(org!.seatLimit).toBe(30);
    expect(org!.projectLimit).toBe(25);
  });
});

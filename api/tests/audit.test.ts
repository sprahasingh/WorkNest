import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/AuditLog.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
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

  return {
    accessToken,
    orgId: meRes.body.memberships[0].tenantId.id as string,
  };
}

describe("audit logging", () => {
  it("records project.created with correct metadata", async () => {
    const admin = await registerOrg("audit-a@example.com", "Audit A");

    await request(app)
      .post(`/api/orgs/${admin.orgId}/projects`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Tracked Project", key: "TR" });

    const logs = await AuditLog.find({
      tenantId: admin.orgId,
      action: "project.created",
    }).setOptions({ skipTenant: true });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({
      name: "Tracked Project",
      key: "TR",
    });
  });

  it("leaves no audit row when the underlying transaction fails", async () => {
    const admin = await registerOrg("audit-b@example.com", "Audit B");

    await request(app)
      .post(`/api/orgs/${admin.orgId}/projects`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "First Project", key: "DUP" });

    const res = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Second Project", key: "DUP" });

    expect(res.status).toBe(409);

    const createdLogs = await AuditLog.find({
      tenantId: admin.orgId,
      action: "project.created",
    }).setOptions({ skipTenant: true });

    expect(createdLogs).toHaveLength(1);
  });
});

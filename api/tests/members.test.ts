import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Membership } from "../src/models/Membership.js";

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
  const userId = meRes.body.user.id as string;

  return { accessToken, orgId, userId };
}

describe("member role changes and the last-admin rule", () => {
  it("rejects the sole admin demoting themselves", async () => {
    const { accessToken, orgId, userId } = await registerAndGetOrg(
      "solo-admin@example.com",
      "Solo Org",
    );

    const membership = await Membership.findOne({
      userId,
      tenantId: orgId,
    }).setOptions({ skipTenant: true });

    const res = await request(app)
      .patch(`/api/orgs/${orgId}/members/${membership!._id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ role: "member" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");

    const org = await Organization.findById(orgId);
    expect(org!.adminCount).toBe(1);
  });

  it("leaves at least one admin when two admins try to demote each other concurrently", async () => {
    const {
      accessToken: tokenA,
      orgId,
      userId: userA,
    } = await registerAndGetOrg("admin-a@example.com", "Concurrent Org");

    const inviteeRes = await request(app).post("/api/auth/register").send({
      name: "Admin B",
      email: "admin-b@example.com",
      password: "password123",
      orgName: "Unused Org B",
    });

    const userB = (
      await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${inviteeRes.body.accessToken}`)
    ).body.user.id as string;

    const newAdminMembership = new Membership({
      tenantId: orgId,
      userId: userB,
      role: "admin",
    });
    newAdminMembership.$locals.skipTenant = true;
    await newAdminMembership.save();

    await Organization.findByIdAndUpdate(orgId, {
      $inc: { adminCount: 1, seatsUsed: 1 },
    });

    const membershipA = await Membership.findOne({
      userId: userA,
      tenantId: orgId,
    }).setOptions({ skipTenant: true });
    const membershipB = await Membership.findOne({
      userId: userB,
      tenantId: orgId,
    }).setOptions({ skipTenant: true });

    const [resA, resB] = await Promise.all([
      request(app)
        .patch(`/api/orgs/${orgId}/members/${membershipA!._id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ role: "member" }),
      request(app)
        .patch(`/api/orgs/${orgId}/members/${membershipB!._id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ role: "member" }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const org = await Organization.findById(orgId);
    expect(org!.adminCount).toBe(1);

    const adminCount = await Membership.countDocuments({
      tenantId: orgId,
      role: "admin",
    }).setOptions({ skipTenant: true });
    expect(adminCount).toBe(1);
  });
});

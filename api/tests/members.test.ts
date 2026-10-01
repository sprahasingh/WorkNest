import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Membership } from "../src/models/Membership.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function registerAndGetOrg(email: string, orgName: string) {
  const res = await registerAndVerify(app, {
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

async function inviteAndSignup(
  orgId: string,
  adminToken: string,
  email: string,
  role: "manager" | "member",
) {
  await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email, role });

  const token = takeInvitationToken(email);

  const signupRes = await signupInviteAndVerify(app, token, email, {
    name: "Invited User",
    password: "password123",
  });

  const accessToken = signupRes.body.accessToken as string;

  const meRes = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);

  return { accessToken, userId: meRes.body.user.id as string };
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

    const inviteeRes = await registerAndVerify(app, {
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

describe("leaving an organization", () => {
  it("lets a non-admin member remove themselves and releases their seat", async () => {
    const admin = await registerAndGetOrg(
      "leave-admin@example.com",
      "Leave Org",
    );
    const member = await inviteAndSignup(
      admin.orgId,
      admin.accessToken,
      "leaving-member@example.com",
      "member",
    );

    const membership = await Membership.findOne({
      userId: member.userId,
      tenantId: admin.orgId,
    }).setOptions({ skipTenant: true });

    const orgBefore = await Organization.findById(admin.orgId);
    const seatsBefore = orgBefore!.seatsUsed as number;

    const res = await request(app)
      .delete(`/api/orgs/${admin.orgId}/members/${membership!._id}`)
      .set("Authorization", `Bearer ${member.accessToken}`);

    expect(res.status).toBe(204);

    const orgAfter = await Organization.findById(admin.orgId);
    expect(orgAfter!.seatsUsed).toBe(seatsBefore - 1);

    const stillExists = await Membership.findById(membership!._id).setOptions({
      skipTenant: true,
    });
    expect(stillExists).toBeNull();
  });

  it("rejects a member removing someone else", async () => {
    const admin = await registerAndGetOrg(
      "leave-admin-2@example.com",
      "Leave Org 2",
    );
    const memberA = await inviteAndSignup(
      admin.orgId,
      admin.accessToken,
      "member-a@example.com",
      "member",
    );
    const memberB = await inviteAndSignup(
      admin.orgId,
      admin.accessToken,
      "member-b@example.com",
      "member",
    );

    const membershipB = await Membership.findOne({
      userId: memberB.userId,
      tenantId: admin.orgId,
    }).setOptions({ skipTenant: true });

    const res = await request(app)
      .delete(`/api/orgs/${admin.orgId}/members/${membershipB!._id}`)
      .set("Authorization", `Bearer ${memberA.accessToken}`);

    expect(res.status).toBe(403);
  });

  it("rejects the sole admin leaving", async () => {
    const admin = await registerAndGetOrg(
      "leave-sole-admin@example.com",
      "Sole Admin Org",
    );

    const membership = await Membership.findOne({
      userId: admin.userId,
      tenantId: admin.orgId,
    }).setOptions({ skipTenant: true });

    const res = await request(app)
      .delete(`/api/orgs/${admin.orgId}/members/${membership!._id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
  });
});

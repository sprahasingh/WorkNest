import request from "supertest";
import type { Express } from "express";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

export interface Person {
  token: string;
  id: string;
}

// An organization with an admin, plus a helper that adds members to it.
export async function setupOrg(app: Express, domain: string) {
  const response = await registerAndVerify(app, {
    name: "Admin User",
    email: `admin@${domain}`,
    password: "password123",
    orgName: "Test Org",
  });
  const adminToken = response.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${adminToken}`);
  const orgId = me.body.memberships[0].tenantId.id as string;

  async function addMember(
    name: string,
    role: "member" | "manager" = "member",
  ): Promise<Person & { membershipId: string }> {
    const email = `${name}@${domain}`;
    await request(app)
      .post(`/api/orgs/${orgId}/invites`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, role });
    const signup = await signupInviteAndVerify(
      app,
      takeInvitationToken(email),
      email,
      { name, password: "password123" },
    );
    const token = signup.body.accessToken as string;
    const profile = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    const membership = profile.body.memberships.find(
      (m: { tenantId: { id: string } }) => m.tenantId.id === orgId,
    );
    return {
      token,
      id: profile.body.user.id as string,
      membershipId: membership._id as string,
    };
  }

  const adminMembership = me.body.memberships[0]._id as string;
  return {
    orgId,
    admin: {
      token: adminToken,
      id: me.body.user.id as string,
      membershipId: adminMembership,
    },
    addMember,
  };
}

export const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60 * 1000).toISOString();
export const inDays = (days: number, hour = 10) => {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

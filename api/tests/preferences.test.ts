import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function registerUser(email: string, orgName: string) {
  const signup = await registerAndVerify(app, {
    name: "Preference User",
    email,
    password: "Harbor-lamp-91",
    orgName,
  });
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
    orgId: me.body.memberships[0].tenantId.id as string,
  };
}

describe("lifecycle sort preferences", () => {
  it("persists per user, project context and lifecycle view", async () => {
    const admin = await registerUser(
      "sort-preferences-admin@example.com",
      "Sort Preferences",
    );
    const memberEmail = "sort-preferences-member@example.com";
    const invitation = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: memberEmail, role: "member" });
    expect(invitation.status).toBe(201);
    const memberSignup = await signupInviteAndVerify(
      app,
      takeInvitationToken(memberEmail),
      memberEmail,
      { name: "Another Preference User", password: "Harbor-lamp-91" },
    );
    const member = { accessToken: memberSignup.body.accessToken as string };
    const base = `/api/orgs/${admin.orgId}/preferences/lifecycle-sort`;
    const projectOne = "64b000000000000000000001";
    const projectTwo = "64b000000000000000000002";
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
    });

    const empty = await request(app)
      .get(base)
      .query({ context: projectOne })
      .set(headers(admin.accessToken))
      .expect(200);
    expect(empty.body.preferences).toEqual({});

    await request(app)
      .put(base)
      .set(headers(admin.accessToken))
      .send({ context: "projects", view: "active", sort: "dueDate:desc" })
      .expect(200);
    await request(app)
      .put(base)
      .set(headers(admin.accessToken))
      .send({ context: projectOne, view: "active", sort: "createdAt:asc" })
      .expect(200);
    await request(app)
      .put(base)
      .set(headers(admin.accessToken))
      .send({ context: projectOne, view: "completed", sort: "dueDate:desc" })
      .expect(200);

    const listPreferences = await request(app)
      .get(base)
      .query({ context: "projects" })
      .set(headers(admin.accessToken))
      .expect(200);
    expect(listPreferences.body.preferences).toEqual({
      active: "dueDate:desc",
    });

    const firstProjectPreferences = await request(app)
      .get(base)
      .query({ context: projectOne })
      .set(headers(admin.accessToken))
      .expect(200);
    expect(firstProjectPreferences.body.preferences).toEqual({
      active: "createdAt:asc",
      completed: "dueDate:desc",
    });

    const otherProjectPreferences = await request(app)
      .get(base)
      .query({ context: projectTwo })
      .set(headers(admin.accessToken))
      .expect(200);
    expect(otherProjectPreferences.body.preferences).toEqual({});

    const otherUserPreferences = await request(app)
      .get(base)
      .query({ context: projectOne })
      .set(headers(member.accessToken))
      .expect(200);
    expect(otherUserPreferences.body.preferences).toEqual({});

    await request(app)
      .put(base)
      .set(headers(admin.accessToken))
      .send({ context: projectOne, view: "active", sort: "archivedAt:desc" })
      .expect(400);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { User } from "../src/models/User.js";
import { registerAndVerify, takeInvitationEmail } from "./emailDeliveryMock.js";

// The auth rate limit allows 10 sign-ups per file; this file uses 8.
const app = createApp();

async function register(email: string, orgName: string) {
  const res = await registerAndVerify(app, {
    name: `${orgName} Owner`,
    email,
    password: "Harbor-lamp-91",
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
    auth: { Authorization: `Bearer ${accessToken}` },
  };
}

async function seatsUsed(orgId: string) {
  const org = await Organization.findById(orgId);
  return Number(org!.seatsUsed);
}

async function memberships(auth: Record<string, string>) {
  const me = await request(app).get("/api/auth/me").set(auth);
  return me.body.memberships as Array<{
    _id: string;
    tenantId: { id: string };
  }>;
}

// The database is emptied after every test, so each test signs people up.
const people = {
  admin: () => register("invites-admin@example.com", "Inviting Org"),
  sam: () => register("invites-sam@example.com", "Sam Org"),
  riley: () => register("invites-riley@example.com", "Riley Org"),
};

describe("inviting someone who already has an account", () => {
  it("shows the invite in their app, and joining keeps their other org", async () => {
    const admin = await people.admin();
    const sam = await people.sam();

    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email: "invites-sam@example.com", role: "manager" });
    expect(created.status).toBe(201);
    expect(created.body.existingUser).toBe(true);

    const pendingList = await request(app)
      .get(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth);
    expect(pendingList.body.invites[0]).toMatchObject({
      email: "invites-sam@example.com",
      existingUser: true,
    });

    const inbox = await request(app).get("/api/me/invites").set(sam.auth);
    expect(inbox.status).toBe(200);
    expect(inbox.body.invites).toHaveLength(1);
    expect(inbox.body.invites[0]).toMatchObject({
      organization: { id: admin.orgId, name: "Inviting Org" },
      role: "manager",
      invitedBy: { name: "Inviting Org Owner" },
    });

    // Someone else can't act on it.
    const riley = await people.riley();
    const stolen = await request(app)
      .post(`/api/me/invites/${inbox.body.invites[0]._id}/accept`)
      .set(riley.auth);
    expect(stolen.status).toBe(403);
    expect(stolen.body.error.code).toBe("EMAIL_MISMATCH");

    const accepted = await request(app)
      .post(`/api/me/invites/${inbox.body.invites[0]._id}/accept`)
      .set(sam.auth);
    expect(accepted.status).toBe(200);
    expect(accepted.body.membership.role).toBe("manager");

    const orgs = (await memberships(sam.auth)).map((m) => m.tenantId.id);
    expect(orgs).toEqual(expect.arrayContaining([sam.orgId, admin.orgId]));

    const after = await request(app).get("/api/me/invites").set(sam.auth);
    expect(after.body.invites).toHaveLength(0);
  });

  it("frees the seat when the invite is declined", async () => {
    const admin = await people.admin();
    const riley = await people.riley();
    const before = await seatsUsed(admin.orgId);

    await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email: "invites-riley@example.com", role: "member" });
    expect(await seatsUsed(admin.orgId)).toBe(before + 1);

    const inbox = await request(app).get("/api/me/invites").set(riley.auth);
    const inviteId = inbox.body.invites[0]._id as string;

    const declined = await request(app)
      .post(`/api/me/invites/${inviteId}/decline`)
      .set(riley.auth);
    expect(declined.status).toBe(204);
    expect(await seatsUsed(admin.orgId)).toBe(before);

    const again = await request(app)
      .post(`/api/me/invites/${inviteId}/accept`)
      .set(riley.auth);
    expect(again.status).toBe(410);

    const audit = await request(app)
      .get(`/api/orgs/${admin.orgId}/audit-logs`)
      .query({ action: "invite.declined" })
      .set(admin.auth);
    expect(audit.body.items).toHaveLength(1);
  });
});

describe("inviting an email that already has a pending invite", () => {
  it("explains it instead of a generic conflict, and can replace the link", async () => {
    const admin = await people.admin();
    const email = "invites-newcomer@example.com";

    const first = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email, role: "member" });
    expect(first.body.existingUser).toBe(false);
    const oldToken = new URL(takeInvitationEmail(email).inviteUrl).pathname
      .split("/")
      .at(-1);
    const seats = await seatsUsed(admin.orgId);

    const duplicate = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email, role: "member" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("INVITE_ALREADY_PENDING");

    const replaced = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email, role: "manager", replaceExisting: true });
    expect(replaced.status).toBe(201);
    expect(await seatsUsed(admin.orgId)).toBe(seats);
    const replacementToken = new URL(
      takeInvitationEmail(email).inviteUrl,
    ).pathname
      .split("/")
      .at(-1);
    expect(replacementToken).not.toBe(oldToken);

    const oldPreview = await request(app).get(`/api/invites/${oldToken}`);
    expect(oldPreview.body).toMatchObject({
      status: "revoked",
      accountExists: false,
    });

    const pending = await request(app)
      .get(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth);
    const forEmail = pending.body.invites.filter(
      (i: { email: string }) => i.email === email,
    );
    expect(forEmail).toHaveLength(1);
    expect(forEmail[0].role).toBe("manager");
  });
});

describe("removing a member", () => {
  it("keeps their account, unassigns their tasks here, and lets them be invited back", async () => {
    const admin = await people.admin();
    const sam = await people.sam();

    // Sam joins the admin's org first, through an in-app invite.
    await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email: "invites-sam@example.com", role: "member" });
    const pending = await request(app).get("/api/me/invites").set(sam.auth);
    const joined = await request(app)
      .post(`/api/me/invites/${pending.body.invites[0]._id}/accept`)
      .set(sam.auth);
    expect(joined.status).toBe(200);

    const samMembership = (
      await request(app).get(`/api/orgs/${admin.orgId}/members`).set(admin.auth)
    ).body.members.find(
      (m: { userId: { id: string } }) => m.userId.id === sam.userId,
    );

    const project = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects`)
      .set(admin.auth)
      .send({ name: "Launch", key: "LCH" });
    const task = await request(app)
      .post(
        `/api/orgs/${admin.orgId}/projects/${project.body.project._id}/tasks`,
      )
      .set(admin.auth)
      .send({ title: "Ship it", assigneeIds: [sam.userId, admin.userId] });
    expect(task.status).toBe(201);

    const removed = await request(app)
      .delete(`/api/orgs/${admin.orgId}/members/${samMembership._id}`)
      .set(admin.auth);
    expect(removed.status).toBe(204);

    // Their account and their own org are untouched.
    expect(
      await User.exists({ email: "invites-sam@example.com" }),
    ).toBeTruthy();
    const orgs = (await memberships(sam.auth)).map((m) => m.tenantId.id);
    expect(orgs).toEqual([sam.orgId]);

    const lost = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects`)
      .set(sam.auth);
    expect(lost.status).toBe(404);

    const taskAfter = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${task.body.task._id}`)
      .set(admin.auth);
    expect(taskAfter.body.task.assigneeIds).toEqual([admin.userId]);

    const audit = await request(app)
      .get(`/api/orgs/${admin.orgId}/audit-logs`)
      .query({ action: "member.removed" })
      .set(admin.auth);
    expect(audit.body.items[0].metadata).toMatchObject({
      email: "invites-sam@example.com",
      self: false,
      unassignedTaskCount: 1,
    });

    const reinvite = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set(admin.auth)
      .send({ email: "invites-sam@example.com", role: "member" });
    expect(reinvite.status).toBe(201);
    expect(reinvite.body.existingUser).toBe(true);
    const inbox = await request(app).get("/api/me/invites").set(sam.auth);
    expect(inbox.body.invites).toHaveLength(1);
  });
});

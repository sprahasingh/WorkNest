import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const res = await request(app).post("/api/auth/register").send({
    name: "Admin User",
    email,
    password: "password123",
    orgName,
  });
  const accessToken = res.body.accessToken as string;
  const refreshCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
    refreshCookie,
    orgId: me.body.memberships[0].tenantId.id as string,
    userId: me.body.user.id as string,
  };
}

async function addMember(
  orgId: string,
  adminToken: string,
  email: string,
  role: "member" | "manager" = "member",
) {
  const inviteRes = await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email, role });
  const token = (inviteRes.body.inviteUrl as string).split("/invite/")[1];
  const signup = await request(app)
    .post(`/api/invites/${token}/signup`)
    .send({ name: `User ${email}`, password: "password123" });
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return { accessToken, userId: me.body.user.id as string };
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

describe("personal information", () => {
  it("updates profile and password after verifying the current password", async () => {
    const account = await registerOrg("profile@example.com", "Profile Org");
    expect(account.refreshCookie).toBeTruthy();

    const updated = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${account.accessToken}`)
      .set("Cookie", account.refreshCookie!)
      .send({
        name: "Updated Person",
        email: "updated@example.com",
        currentPassword: "password123",
        newPassword: "new-password-456",
      });

    expect(updated.status).toBe(200);
    expect(updated.body.user).toMatchObject({
      name: "Updated Person",
      email: "updated@example.com",
    });
    expect(updated.body.user.passwordHash).toBeUndefined();

    const oldCredentials = await request(app)
      .post("/api/auth/login")
      .send({ email: "profile@example.com", password: "password123" });
    expect(oldCredentials.status).toBe(401);

    const newCredentials = await request(app)
      .post("/api/auth/login")
      .send({ email: "updated@example.com", password: "new-password-456" });
    expect(newCredentials.status).toBe(200);

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", account.refreshCookie!);
    expect(refresh.status).toBe(200);
  });

  it("rejects an incorrect current password and a duplicate email", async () => {
    const first = await registerOrg("first-profile@example.com", "First Org");
    await registerOrg("taken-profile@example.com", "Second Org");

    const incorrectPassword = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({
        name: "Changed Person",
        email: "first-profile@example.com",
        currentPassword: "wrong-password",
      });
    expect(incorrectPassword.status).toBe(401);
    expect(incorrectPassword.body.error.code).toBe("CURRENT_PASSWORD_INVALID");

    const duplicateEmail = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({
        name: "Admin User",
        email: "taken-profile@example.com",
        currentPassword: "password123",
      });
    expect(duplicateEmail.status).toBe(409);
    expect(duplicateEmail.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });
});

describe("account deletion", () => {
  it("blocks a sole admin with teammates, then frees the email for re-registration", async () => {
    const admin = await registerOrg("leaver@example.com", "Leaver Org");
    const member = await addMember(
      admin.orgId,
      admin.accessToken,
      "stayer@example.com",
    );

    const blocked = await request(app)
      .delete("/api/auth/me")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("SOLE_ADMIN");

    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "DEL",
    );
    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Handover",
      assigneeIds: [member.userId],
    });

    const deleted = await request(app)
      .delete("/api/auth/me")
      .set("Authorization", `Bearer ${member.accessToken}`);
    expect(deleted.status).toBe(204);

    const after = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${task.body.task._id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(after.body.task.assigneeIds).toEqual([]);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "stayer@example.com", password: "password123" });
    expect(login.status).toBe(401);

    const again = await request(app).post("/api/auth/register").send({
      name: "Back Again",
      email: "stayer@example.com",
      password: "password123",
      orgName: "Fresh Start",
    });
    expect(again.status).toBe(201);
  });
});

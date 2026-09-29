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
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
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

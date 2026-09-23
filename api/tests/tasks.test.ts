import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

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
    userId: meRes.body.user.id as string,
  };
}

async function createProject(orgId: string, token: string, key: string) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${key}`, key });

  return res.body.project._id as string;
}

describe("cross-tenant task reference checks", () => {
  it("rejects creating a task against another org's projectId", async () => {
    const orgA = await registerOrg("task-a@example.com", "Task Org A");
    const orgB = await registerOrg("task-b@example.com", "Task Org B");
    const projectIdA = await createProject(orgA.orgId, orgA.accessToken, "AA");

    const res = await request(app)
      .post(`/api/orgs/${orgB.orgId}/projects/${projectIdA}/tasks`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ title: "Malicious task" });

    expect(res.status).toBe(404);
  });

  it("rejects assigning a task to a user from another org", async () => {
    const orgA = await registerOrg("task-c@example.com", "Task Org C");
    const orgB = await registerOrg("task-d@example.com", "Task Org D");
    const projectIdA = await createProject(orgA.orgId, orgA.accessToken, "CC");

    const res = await request(app)
      .post(`/api/orgs/${orgA.orgId}/projects/${projectIdA}/tasks`)
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ title: "Bad assignment", assigneeId: orgB.userId });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ASSIGNEE");
  });
});

describe("task ownership rules", () => {
  it("lets a member edit their own task but not someone else's, and blocks reassignment", async () => {
    const admin = await registerOrg("owner-admin@example.com", "Owner Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "OW");

    const inviteRes = await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: "member-owner@example.com", role: "member" });

    const inviteUrl = inviteRes.body.inviteUrl as string;
    const token = inviteUrl.split("/invite/")[1];

    const signupRes = await request(app)
      .post(`/api/invites/${token}/signup`)
      .send({ name: "Regular Member", password: "password123" });

    const memberToken = signupRes.body.accessToken as string;

    const memberMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${memberToken}`);
    const memberId = memberMe.body.user.id as string;

    const ownTaskRes = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "My own task" });

    const ownTaskId = ownTaskRes.body.task._id as string;

    const editOwnRes = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${ownTaskId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Updated by owner" });

    expect(editOwnRes.status).toBe(200);

    const othersTaskRes = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Admin's task" });

    const othersTaskId = othersTaskRes.body.task._id as string;

    const editOthersRes = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${othersTaskId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Hijacked" });

    expect(editOthersRes.status).toBe(403);

    const reassignRes = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${ownTaskId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ assigneeId: memberId });

    expect(reassignRes.status).toBe(403);
  });
});

describe("task pagination", () => {
  it("returns every item exactly once across pages, even with concurrent inserts", async () => {
    const admin = await registerOrg("page-admin@example.com", "Page Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "PG");

    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        request(app)
          .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
          .set("Authorization", `Bearer ${admin.accessToken}`)
          .send({ title: `Task ${i}` }),
      ),
    );

    const seen = new Set<string>();
    let cursor: string | null = null;

    do {
      const query: Record<string, string | number> = { limit: 4 };
      if (cursor) {
        query.cursor = cursor;
      }

      const res = await request(app)
        .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
        .query(query)
        .set("Authorization", `Bearer ${admin.accessToken}`);

      for (const item of res.body.items) {
        seen.add(item._id);
      }

      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen.size).toBe(15);
  });
});

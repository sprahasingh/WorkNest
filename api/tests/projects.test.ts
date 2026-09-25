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
  };
}

async function createProject(
  orgId: string,
  token: string,
  key: string,
  name?: string,
) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: name ?? `Project ${key}`, key });
}

describe("project limits", () => {
  it("enforces the free plan's project limit and releases a slot on delete", async () => {
    const org = await registerOrg("proj-limit@example.com", "Limit Org");

    const first = await createProject(org.orgId, org.accessToken, "PA");
    const second = await createProject(org.orgId, org.accessToken, "PB");
    const third = await createProject(org.orgId, org.accessToken, "PC");

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);

    const fourth = await createProject(org.orgId, org.accessToken, "PD");
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe("PROJECT_LIMIT_REACHED");

    const deleteRes = await request(app)
      .delete(`/api/orgs/${org.orgId}/projects/${first.body.project._id}`)
      .set("Authorization", `Bearer ${org.accessToken}`);
    expect(deleteRes.status).toBe(204);

    const afterDelete = await createProject(org.orgId, org.accessToken, "PE");
    expect(afterDelete.status).toBe(201);
  });

  it("rejects a duplicate project key within the same tenant", async () => {
    const org = await registerOrg("proj-dup@example.com", "Dup Org");

    const firstRes = await createProject(org.orgId, org.accessToken, "DUP");
    expect(firstRes.status).toBe(201);

    const secondRes = await createProject(org.orgId, org.accessToken, "DUP");
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe("CONFLICT");
  });
});

describe("project archive and delete", () => {
  it("hides an archived project from the default list but keeps it under archived=true", async () => {
    const org = await registerOrg("proj-archive@example.com", "Archive Org");
    const created = await createProject(org.orgId, org.accessToken, "ARC");
    const projectId = created.body.project._id as string;

    const archiveRes = await request(app)
      .post(`/api/orgs/${org.orgId}/projects/${projectId}/archive`)
      .set("Authorization", `Bearer ${org.accessToken}`);
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.project.archivedAt).not.toBeNull();

    const activeList = await request(app)
      .get(`/api/orgs/${org.orgId}/projects`)
      .set("Authorization", `Bearer ${org.accessToken}`);
    expect(
      activeList.body.projects.some(
        (p: { _id: string }) => p._id === projectId,
      ),
    ).toBe(false);

    const archivedList = await request(app)
      .get(`/api/orgs/${org.orgId}/projects`)
      .query({ archived: "true" })
      .set("Authorization", `Bearer ${org.accessToken}`);
    expect(
      archivedList.body.projects.some(
        (p: { _id: string }) => p._id === projectId,
      ),
    ).toBe(true);
  });

  it("deleting a project also deletes its tasks", async () => {
    const org = await registerOrg("proj-cascade@example.com", "Cascade Org");
    const created = await createProject(org.orgId, org.accessToken, "CAS");
    const projectId = created.body.project._id as string;

    const taskRes = await request(app)
      .post(`/api/orgs/${org.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ title: "Doomed task" });
    const taskId = taskRes.body.task._id as string;

    const deleteRes = await request(app)
      .delete(`/api/orgs/${org.orgId}/projects/${projectId}`)
      .set("Authorization", `Bearer ${org.accessToken}`);
    expect(deleteRes.status).toBe(204);

    const taskAfterDelete = await request(app)
      .get(`/api/orgs/${org.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${org.accessToken}`);
    expect(taskAfterDelete.status).toBe(404);
  });
});

describe("cross-tenant project access", () => {
  it("returns 404 for get, update, archive, and delete on another org's project", async () => {
    const orgA = await registerOrg("proj-a@example.com", "Project Org A");
    const orgB = await registerOrg("proj-b@example.com", "Project Org B");
    const created = await createProject(orgA.orgId, orgA.accessToken, "XA");
    const projectId = created.body.project._id as string;

    const getRes = await request(app)
      .get(`/api/orgs/${orgB.orgId}/projects/${projectId}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`);
    expect(getRes.status).toBe(404);

    const updateRes = await request(app)
      .patch(`/api/orgs/${orgB.orgId}/projects/${projectId}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ name: "Hijacked" });
    expect(updateRes.status).toBe(404);

    const archiveRes = await request(app)
      .post(`/api/orgs/${orgB.orgId}/projects/${projectId}/archive`)
      .set("Authorization", `Bearer ${orgB.accessToken}`);
    expect(archiveRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/api/orgs/${orgB.orgId}/projects/${projectId}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`);
    expect(deleteRes.status).toBe(404);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import mongoose from "mongoose";
import { Organization } from "../src/models/Organization.js";
import { Project } from "../src/models/Project.js";
import { Task } from "../src/models/Task.js";
import { registerAndVerify } from "./emailDeliveryMock.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
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
    // Deleting moves it to the bin, which frees its slot.
    expect(deleteRes.status).toBe(200);

    const afterDelete = await createProject(org.orgId, org.accessToken, "PE");
    expect(afterDelete.status).toBe(201);
  });

  it("allows exactly one success when 10 concurrent creates compete for 1 remaining project slot", async () => {
    const org = await registerOrg(
      "proj-race-admin@example.com",
      "Project Race Org",
    );

    await Organization.findByIdAndUpdate(org.orgId, { projectLimit: 1 });

    const keys = ["AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ"];
    const results = await Promise.all(
      keys.map((key) => createProject(org.orgId, org.accessToken, key)),
    );

    const successes = results.filter((r) => r.status === 201);
    const failures = results.filter((r) => r.status === 409);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(9);
    expect(
      failures.every((r) => r.body.error.code === "PROJECT_LIMIT_REACHED"),
    ).toBe(true);

    const orgAfter = await Organization.findById(org.orgId);
    expect(orgAfter!.projectCount).toBe(orgAfter!.projectLimit);
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

  it("lists each project's active and total task counts, and how many projects are active or archived", async () => {
    const org = await registerOrg("proj-counts@example.com", "Counts Org");
    const busy = await createProject(org.orgId, org.accessToken, "BSY");
    const idle = await createProject(org.orgId, org.accessToken, "IDL");
    const old = await createProject(org.orgId, org.accessToken, "OLD");
    const busyId = busy.body.project._id as string;
    const auth = { Authorization: `Bearer ${org.accessToken}` };
    await request(app)
      .patch(`/api/orgs/${org.orgId}/projects/${busyId}`)
      .set(auth)
      .send({ priority: "high" });

    const taskIds: string[] = [];
    for (const title of ["One", "Two", "Three"]) {
      const res = await request(app)
        .post(`/api/orgs/${org.orgId}/projects/${busyId}/tasks`)
        .set(auth)
        .send({ title });
      taskIds.push(res.body.task._id as string);
    }
    await request(app)
      .patch(`/api/orgs/${org.orgId}/tasks/${taskIds[0]}`)
      .set(auth)
      .send({ status: "done" });
    await request(app)
      .patch(`/api/orgs/${org.orgId}/tasks/${taskIds[1]}`)
      .set(auth)
      .send({ status: "in_progress" });
    await request(app)
      .post(`/api/orgs/${org.orgId}/projects/${old.body.project._id}/archive`)
      .set(auth);

    const list = await request(app)
      .get(`/api/orgs/${org.orgId}/projects`)
      .set(auth);
    expect(list.status).toBe(200);
    expect(list.body.counts).toEqual({ active: 2, archived: 1, bin: 0 });

    const byId = new Map(
      (
        list.body.projects as Array<{
          _id: string;
          priority: string;
          activeTaskCount: number;
          completedTaskCount: number;
          todoTaskCount: number;
          inProgressTaskCount: number;
          taskCount: number;
        }>
      ).map((p) => [p._id, p]),
    );
    expect(byId.get(busyId)).toMatchObject({
      priority: "high",
      activeTaskCount: 2,
      completedTaskCount: 1,
      todoTaskCount: 1,
      inProgressTaskCount: 1,
      taskCount: 3,
    });
    expect(byId.get(idle.body.project._id as string)).toMatchObject({
      activeTaskCount: 0,
      completedTaskCount: 0,
      todoTaskCount: 0,
      inProgressTaskCount: 0,
      taskCount: 0,
    });

    const archivedList = await request(app)
      .get(`/api/orgs/${org.orgId}/projects`)
      .query({ archived: "true" })
      .set(auth);
    expect(archivedList.body.counts).toEqual({
      active: 2,
      archived: 1,
      bin: 0,
    });
    expect(archivedList.body.projects).toHaveLength(1);
  });

  it("deleting moves a project to the bin, hiding its tasks until restored or deleted for good", async () => {
    const org = await registerOrg("proj-cascade@example.com", "Cascade Org");
    const created = await createProject(org.orgId, org.accessToken, "CAS");
    const projectId = created.body.project._id as string;
    const auth = { Authorization: `Bearer ${org.accessToken}` };
    const base = `/api/orgs/${org.orgId}`;

    const taskRes = await request(app)
      .post(`${base}/projects/${projectId}/tasks`)
      .set(auth)
      .send({ title: "Doomed task" });
    const taskId = taskRes.body.task._id as string;

    const binned = await request(app)
      .delete(`${base}/projects/${projectId}`)
      .set(auth);
    expect(binned.status).toBe(200);
    expect(binned.body.project.deletedAt).not.toBeNull();

    expect(
      (await request(app).get(`${base}/tasks/${taskId}`).set(auth)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`${base}/projects/${projectId}`).set(auth))
        .status,
    ).toBe(404);

    const bin = await request(app)
      .get(`${base}/projects`)
      .query({ view: "bin" })
      .set(auth);
    expect(bin.body.projects).toHaveLength(1);
    expect(bin.body.projects[0].purgeAt).toBeTruthy();
    expect(bin.body.counts).toMatchObject({ active: 0, bin: 1 });

    const restored = await request(app)
      .post(`${base}/projects/${projectId}/restore`)
      .set(auth);
    expect(restored.status).toBe(200);
    expect(
      (await request(app).get(`${base}/tasks/${taskId}`).set(auth)).status,
    ).toBe(200);

    // Permanent deletion only works from the bin.
    const tooSoon = await request(app)
      .delete(`${base}/projects/${projectId}/permanent`)
      .set(auth);
    expect(tooSoon.status).toBe(404);

    await request(app).delete(`${base}/projects/${projectId}`).set(auth);
    const gone = await request(app)
      .delete(`${base}/projects/${projectId}/permanent`)
      .set(auth);
    expect(gone.status).toBe(204);
    expect(
      await Task.collection.findOne({
        _id: new mongoose.Types.ObjectId(taskId),
      }),
    ).toBeNull();
  });

  it("unarchives, needs a free slot to restore, guards keys in the bin, and empties the bin after 30 days", async () => {
    const org = await registerOrg("proj-bin@example.com", "Bin Org");
    const auth = { Authorization: `Bearer ${org.accessToken}` };
    const base = `/api/orgs/${org.orgId}`;

    const a = await createProject(org.orgId, org.accessToken, "AAA");
    const aId = a.body.project._id as string;

    await request(app).post(`${base}/projects/${aId}/archive`).set(auth);
    const unarchived = await request(app)
      .post(`${base}/projects/${aId}/unarchive`)
      .set(auth);
    expect(unarchived.status).toBe(200);
    expect(unarchived.body.project.archivedAt).toBeNull();

    await request(app).delete(`${base}/projects/${aId}`).set(auth);

    const sameKey = await createProject(org.orgId, org.accessToken, "AAA");
    expect(sameKey.status).toBe(409);
    expect(sameKey.body.error.message).toMatch(/in the bin/);

    // Fill every slot, then restoring needs one back.
    await createProject(org.orgId, org.accessToken, "BBB");
    await createProject(org.orgId, org.accessToken, "CCC");
    await createProject(org.orgId, org.accessToken, "DDD");
    const blocked = await request(app)
      .post(`${base}/projects/${aId}/restore`)
      .set(auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("PROJECT_LIMIT_REACHED");

    // Past 30 days in the bin, it's deleted for good.
    await Project.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(aId) },
      { $set: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } },
    );
    const bin = await request(app)
      .get(`${base}/projects`)
      .query({ view: "bin" })
      .set(auth);
    expect(bin.body.projects).toHaveLength(0);
    expect(
      await Project.exists({ _id: aId }).setOptions({
        includeDeleted: true,
        skipTenant: true,
      }),
    ).toBeNull();
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

describe("project due dates", () => {
  it("stores date-only deadlines and supports clearing them", async () => {
    const org = await registerOrg("proj-due-date@example.com", "Due Date Org");
    const created = await request(app)
      .post(`/api/orgs/${org.orgId}/projects`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Deadline project", key: "DUE", dueDate: "2025-02-03" });

    expect(created.status).toBe(201);
    expect(created.body.project.dueDate).toBe("2025-02-03T23:59:59.999Z");
    expect(created.body.project.dueDateIsDateOnly).toBe(true);

    const updated = await request(app)
      .patch(
        `/api/orgs/${org.orgId}/projects/${created.body.project._id as string}`,
      )
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ dueDate: null });

    expect(updated.status).toBe(200);
    expect(updated.body.project.dueDate).toBeNull();
    expect(updated.body.project.dueDateIsDateOnly).toBe(false);
    expect(updated.body.project.reminderCycle).toBe(1);
  });
});

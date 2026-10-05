import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Project } from "../src/models/Project.js";
import { Task } from "../src/models/Task.js";
import { TaskActivity } from "../src/models/TaskActivity.js";
import {
  enforceDueGracePeriods,
  enforceGraceIfDue,
} from "../src/modules/billing/gracePeriod.service.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function proOrg(domain: string) {
  const { orgId, admin } = await setupOrg(app, domain);
  await Organization.updateOne(
    { _id: orgId },
    { plan: "pro", seatLimit: 30, projectLimit: 25 },
  );
  return { orgId, admin };
}

async function project(orgId: string, token: string, key: string) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set(auth(token))
    .send({ name: `Project ${key}`, key });
  expect(res.status).toBe(201);
  return res.body.project._id as string;
}

async function task(
  orgId: string,
  token: string,
  projectId: string,
  n: number,
) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set(auth(token))
    .send({ title: `Task ${n}` });
  expect(res.status).toBe(201);
  return res.body.task._id as string;
}

// The plan ended `days` ago and the workspace is back on Free.
const expireAgo = (orgId: string, days: number) =>
  Organization.updateOne(
    { _id: orgId },
    {
      plan: "free",
      seatLimit: 5,
      projectLimit: 3,
      planExpiredAt: ago(days),
      planExpiredFrom: "pro",
      graceEnforcedAt: null,
    },
  );

describe("grace period after a plan expires", () => {
  it("keeps everything for 10 days, and the account stays usable", async () => {
    const { orgId, admin } = await proOrg("grace1.test");
    const ids: string[] = [];
    for (const key of ["AAA", "BBB", "CCC", "DDD", "EEE"]) {
      ids.push(await project(orgId, admin.token, key));
    }
    await expireAgo(orgId, 9);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.status).toBe(200);
    expect(org.body.usage.overLimit).toBe(true);
    expect(org.body.usage.inGrace).toBe(true);
    expect(org.body.usage.paused).toBe(false);
    expect(new Date(org.body.usage.graceEndsAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // Still able to work, and nothing is archived yet.
    const edit = await request(app)
      .patch(`/api/orgs/${orgId}/projects/${ids[0]}`)
      .set(auth(admin.token))
      .send({ name: "Renamed" });
    expect(edit.status).toBe(200);
    expect(await Project.countDocuments({ archivedAt: { $ne: null } })).toBe(0);
    expect(await enforceDueGracePeriods()).toBe(0);
  });

  it("archives the least recently active projects after 10 days, and deletes nothing", async () => {
    const { orgId, admin } = await proOrg("grace2.test");
    const keys = ["AAA", "BBB", "CCC", "DDD", "EEE"];
    const ids: string[] = [];
    for (const key of keys) ids.push(await project(orgId, admin.token, key));
    const taskIds: string[] = [];
    for (const [i, id] of ids.entries()) {
      taskIds.push(await task(orgId, admin.token, id, i));
    }
    // Last changed: AAA 1 day ago ... EEE 5 days ago, except that the oldest
    // (EEE) has a comment from today, which counts as activity.
    for (const [i, id] of ids.entries()) {
      const when = ago(i + 1);
      await Project.collection.updateOne(
        { _id: oid(id) },
        { $set: { updatedAt: when } },
      );
      await Task.collection.updateOne(
        { _id: oid(taskIds[i]!) },
        { $set: { updatedAt: when } },
      );
    }
    await TaskActivity.collection.insertOne({
      tenantId: oid(orgId),
      projectId: oid(ids[4]!),
      taskId: oid(taskIds[4]!),
      createdAt: new Date(),
    });
    await expireAgo(orgId, 11);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.status).toBe(200);

    const archived = await Project.find({ archivedAt: { $ne: null } });
    // Kept: EEE (recent comment), AAA, BBB. Archived: CCC and DDD.
    expect(archived.map((p) => p.key).sort()).toEqual(["CCC", "DDD"]);
    expect(archived.every((p) => p.archivedReason === "plan_limit")).toBe(true);
    // Nothing was deleted, and the tasks are still there.
    expect(await Project.countDocuments({})).toBe(5);
    expect(await Task.countDocuments({})).toBe(5);

    const after = await Organization.findById(orgId).lean();
    expect(after?.projectCount).toBe(3);
    expect(after?.graceEnforcedAt).not.toBeNull();
    expect(after?.graceArchived).toEqual({ projects: 2, tasks: 0 });
    expect(org.body.usage.paused).toBe(false);

    // It only happens once.
    expect(await enforceGraceIfDue(orgId)).toBe(false);

    // With no room on Free, an archived project can't come back; once the
    // plan is upgraded it can.
    const cccId = archived.find((p) => p.key === "CCC")!._id;
    const refused = await request(app)
      .post(`/api/orgs/${orgId}/projects/${cccId}/unarchive`)
      .set(auth(admin.token));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PROJECT_LIMIT_REACHED");

    await Organization.updateOne(
      { _id: orgId },
      { plan: "pro", seatLimit: 30, projectLimit: 25 },
    );
    const restored = await request(app)
      .post(`/api/orgs/${orgId}/projects/${cccId}/unarchive`)
      .set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.project.archivedReason).toBeNull();
  });

  it("archives the least recently active tasks past the Free limit", async () => {
    const { orgId, admin } = await proOrg("grace3.test");
    const projectId = await project(orgId, admin.token, "AAA");
    const taskIds: string[] = [];
    for (let n = 0; n < 13; n += 1) {
      taskIds.push(await task(orgId, admin.token, projectId, n));
    }
    // Task 0 changed 1 day ago, task 12 changed 13 days ago.
    for (const [n, id] of taskIds.entries()) {
      await Task.collection.updateOne(
        { _id: oid(id) },
        { $set: { updatedAt: ago(n + 1) } },
      );
    }
    await expireAgo(orgId, 12);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.status).toBe(200);

    const archived = await Task.find({ archivedAt: { $ne: null } });
    expect(archived).toHaveLength(3);
    expect(archived.map((t) => t.title).sort()).toEqual([
      "Task 10",
      "Task 11",
      "Task 12",
    ]);
    expect(archived.every((t) => t.archivedReason === "plan_limit")).toBe(true);
    expect(await Task.countDocuments({})).toBe(13);
    expect((await Organization.findById(orgId).lean())?.graceArchived).toEqual({
      projects: 0,
      tasks: 3,
    });
    expect(org.body.usage.overLimit).toBe(false);

    // No room for another open task on Free; room after an upgrade.
    const refused = await request(app)
      .patch(`/api/orgs/${orgId}/tasks/${archived[0]!._id}/unarchive`)
      .set(auth(admin.token));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("TASK_LIMIT_REACHED");

    await Organization.updateOne(
      { _id: orgId },
      { plan: "pro", seatLimit: 30, projectLimit: 25 },
    );
    const restored = await request(app)
      .patch(`/api/orgs/${orgId}/tasks/${archived[0]!._id}/unarchive`)
      .set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.task.archivedReason).toBeNull();
  });

  it("is cleared by renewing", async () => {
    const { orgId } = await proOrg("grace4.test");
    await expireAgo(orgId, 11);
    expect(await enforceDueGracePeriods()).toBe(1);
    await Organization.updateOne(
      { _id: orgId },
      { plan: "pro", planExpiredAt: null, graceEnforcedAt: null },
    );
    expect(await enforceDueGracePeriods()).toBe(0);
  });
});

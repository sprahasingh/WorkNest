import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Membership } from "../src/models/Membership.js";
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
  it("restores only selected plan-archived projects within upgraded capacity", async () => {
    const { orgId, admin } = await proOrg("restore-selection.test");
    const firstId = await project(orgId, admin.token, "RST");
    const secondId = await project(orgId, admin.token, "RSU");
    await Project.updateMany(
      { _id: { $in: [firstId, secondId] } },
      { archivedAt: new Date(), archivedReason: "plan_limit" },
    ).setOptions({ skipTenant: true });
    const manualId = await project(orgId, admin.token, "RSV");
    await Project.updateOne(
      { _id: manualId },
      { archivedAt: new Date(), archivedReason: null },
    ).setOptions({ skipTenant: true });
    const response = await request(app)
      .post(`/api/orgs/${orgId}/projects/restore-plan-archived`)
      .set(auth(admin.token))
      .send({ projectIds: [firstId] });
    expect(response.status).toBe(200);
    expect(response.body.projects).toHaveLength(1);
    const states = await Project.find({
      _id: { $in: [firstId, secondId, manualId] },
    })
      .setOptions({ skipTenant: true })
      .lean();
    expect(
      states.find((p) => String(p._id) === firstId)?.archivedAt,
    ).toBeNull();
    expect(
      states.find((p) => String(p._id) === secondId)?.archivedAt,
    ).not.toBeNull();
    expect(
      states.find((p) => String(p._id) === manualId)?.archivedAt,
    ).not.toBeNull();
  });
  it("restores force-archived tasks with selected projects but leaves manual archives", async () => {
    const { orgId, admin } = await proOrg("restore-tasks.test");
    const projectId = await project(orgId, admin.token, "RTS");
    const forceArchived = await task(orgId, admin.token, projectId, 1);
    const manualArchived = await task(orgId, admin.token, projectId, 2);
    await Task.updateOne(
      { _id: forceArchived },
      { archivedAt: new Date(), archivedReason: "plan_limit" },
    ).setOptions({ skipTenant: true });
    await Task.updateOne(
      { _id: manualArchived },
      { archivedAt: new Date(), archivedReason: null },
    ).setOptions({ skipTenant: true });
    const beforeRestore = await Task.findById(forceArchived)
      .setOptions({ skipTenant: true })
      .lean();
    await Project.updateOne(
      { _id: projectId },
      { archivedAt: new Date(), archivedReason: "plan_limit" },
    ).setOptions({ skipTenant: true });

    const response = await request(app)
      .post(`/api/orgs/${orgId}/projects/restore-plan-archived`)
      .set(auth(admin.token))
      .send({ projectIds: [projectId] });

    expect(response.status).toBe(200);
    const states = await Task.find({
      _id: { $in: [forceArchived, manualArchived] },
    })
      .setOptions({ skipTenant: true })
      .lean();
    expect(
      states.find((item) => String(item._id) === forceArchived)?.archivedAt,
    ).toBeNull();
    expect(
      states.find((item) => String(item._id) === forceArchived)?.archivedReason,
    ).toBeNull();
    expect(
      states.find((item) => String(item._id) === forceArchived)?.updatedAt,
    ).toEqual(beforeRestore?.updatedAt);
    expect(
      states.find((item) => String(item._id) === manualArchived)?.archivedAt,
    ).not.toBeNull();
  });
  it("restores only force-archived tasks that fit the upgraded task limit", async () => {
    const { orgId, admin } = await proOrg("restore-task-capacity.test");
    const projectId = await project(orgId, admin.token, "RTC");
    const now = new Date();
    const tasks = Array.from({ length: 51 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      tenantId: new mongoose.Types.ObjectId(orgId),
      projectId: new mongoose.Types.ObjectId(projectId),
      title: `Capacity task ${index}`,
      status: "todo",
      priority: "medium",
      assigneeIds: [],
      dueDate: null,
      completedAt: null,
      archivedAt: index >= 49 ? now : null,
      archivedReason: index >= 49 ? "plan_limit" : null,
      deletedAt: null,
      createdBy: new mongoose.Types.ObjectId(admin.id),
      createdAt: now,
      updatedAt: now,
    }));
    await Task.collection.insertMany(tasks);
    await Project.updateOne(
      { _id: projectId },
      { archivedAt: now, archivedReason: "plan_limit" },
    ).setOptions({ skipTenant: true });

    const response = await request(app)
      .post(`/api/orgs/${orgId}/projects/restore-plan-archived`)
      .set(auth(admin.token))
      .send({ projectIds: [projectId] });

    expect(response.status).toBe(200);
    expect(
      await Task.countDocuments({
        projectId,
        status: { $ne: "done" },
        archivedAt: null,
        deletedAt: null,
      }).setOptions({ skipTenant: true }),
    ).toBe(50);
    expect(
      await Task.countDocuments({
        projectId,
        archivedAt: { $ne: null },
        archivedReason: "plan_limit",
        deletedAt: null,
      }).setOptions({ skipTenant: true }),
    ).toBe(1);
  });
  it("offers force-archived tasks from active projects and restores only within capacity", async () => {
    const { orgId, admin } = await proOrg("restore-active-task-capacity.test");
    const projectId = await project(orgId, admin.token, "RAC");
    const now = new Date();
    const tasks = Array.from({ length: 52 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      tenantId: new mongoose.Types.ObjectId(orgId),
      projectId: new mongoose.Types.ObjectId(projectId),
      title: `Active project task ${index}`,
      status: "todo",
      priority: "medium",
      assigneeIds: [],
      dueDate: null,
      completedAt: null,
      archivedAt: index >= 49 ? now : null,
      archivedReason: index === 51 ? null : index >= 49 ? "plan_limit" : null,
      deletedAt: null,
      createdBy: new mongoose.Types.ObjectId(admin.id),
      createdAt: now,
      updatedAt: now,
    }));
    await Task.collection.insertMany(tasks);
    const candidateResponse = await request(app)
      .get(`/api/orgs/${orgId}/projects/restore-plan-archived/tasks`)
      .set(auth(admin.token));
    expect(candidateResponse.status).toBe(200);
    expect(
      candidateResponse.body.tasks.map((item: { _id: string }) => item._id),
    ).toEqual(
      expect.arrayContaining([String(tasks[49]._id), String(tasks[50]._id)]),
    );
    expect(candidateResponse.body.tasks).toHaveLength(2);

    const response = await request(app)
      .post(`/api/orgs/${orgId}/projects/restore-plan-archived`)
      .set(auth(admin.token))
      .send({
        projectIds: [],
        taskIds: [
          String(tasks[49]._id),
          String(tasks[51]._id),
          String(tasks[50]._id),
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.projects).toHaveLength(0);
    expect(response.body.tasks).toHaveLength(1);
    expect(String(response.body.tasks[0]._id)).toBe(String(tasks[49]._id));
    expect(
      await Task.countDocuments({
        projectId,
        status: { $ne: "done" },
        archivedAt: null,
        deletedAt: null,
      }).setOptions({ skipTenant: true }),
    ).toBe(50);
    expect(
      await Task.countDocuments({
        projectId,
        archivedAt: { $ne: null },
        deletedAt: null,
      }).setOptions({ skipTenant: true }),
    ).toBe(2);
  });
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
    expect(
      await Project.countDocuments({ archivedAt: { $ne: null } }).setOptions({
        skipTenant: true,
      }),
    ).toBe(0);
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

    const archived = await Project.find({
      archivedAt: { $ne: null },
    }).setOptions({ skipTenant: true });
    // Kept: EEE (recent comment), AAA, BBB. Archived: CCC and DDD.
    expect(archived.map((p) => p.key).sort()).toEqual(["CCC", "DDD"]);
    expect(archived.every((p) => p.archivedReason === "plan_limit")).toBe(true);
    // Nothing was deleted, and the tasks are still there.
    expect(
      await Project.countDocuments({}).setOptions({ skipTenant: true }),
    ).toBe(5);
    expect(await Task.countDocuments({}).setOptions({ skipTenant: true })).toBe(
      5,
    );

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

    const archived = await Task.find({ archivedAt: { $ne: null } }).setOptions({
      skipTenant: true,
    });
    expect(archived).toHaveLength(3);
    expect(archived.map((t) => t.title).sort()).toEqual([
      "Task 10",
      "Task 11",
      "Task 12",
    ]);
    expect(archived.every((t) => t.archivedReason === "plan_limit")).toBe(true);
    expect(await Task.countDocuments({}).setOptions({ skipTenant: true })).toBe(
      13,
    );
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

describe("during the grace period, usage can't grow past Free", () => {
  const status = (orgId: string, token: string, id: string, value: string) =>
    request(app)
      .patch(`/api/orgs/${orgId}/tasks/${id}`)
      .set(auth(token))
      .send({ status: value });

  it("does not count completed tasks as active task usage", async () => {
    const { orgId, admin } = await proOrg("grace-completed-count.test");
    const projectId = await project(orgId, admin.token, "AAA");
    const taskIds: string[] = [];
    for (let n = 0; n < 11; n += 1) {
      taskIds.push(await task(orgId, admin.token, projectId, n));
    }
    const completed = await status(orgId, admin.token, taskIds[0]!, "done");
    expect(completed.status).toBe(200);
    await expireAgo(orgId, 5);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.usage.projectsOverTaskLimit).toBe(0);
    expect(org.body.usage.taskLimitOverages).toEqual([]);
    expect(org.body.usage.overLimit).toBe(false);

    const over = await request(app)
      .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
      .set(auth(admin.token))
      .send({ title: "Would exceed the open-task limit" });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe("TASK_LIMIT_REACHED");
  });

  it("blocks new projects at the limit but keeps edit, archive and delete", async () => {
    const { orgId, admin } = await proOrg("grace5.test");
    const ids: string[] = [];
    for (const key of ["AAA", "BBB", "CCC", "DDD", "EEE"]) {
      ids.push(await project(orgId, admin.token, key));
    }
    await expireAgo(orgId, 5);

    const blocked = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Another", key: "FFF" });
    // Over the Free limits, so nothing new can be added at all.
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_GRACE_RESTRICTED");
    expect(blocked.body.error.message).toContain("project limit");

    const rename = await request(app)
      .patch(`/api/orgs/${orgId}/projects/${ids[0]}`)
      .set(auth(admin.token))
      .send({ name: "Renamed" });
    expect(rename.status).toBe(200);

    // Archiving brings usage down. At the limit, there is still no room.
    for (const id of [ids[4]!, ids[3]!]) {
      const archived = await request(app)
        .post(`/api/orgs/${orgId}/projects/${id}/archive`)
        .set(auth(admin.token));
      expect(archived.status).toBe(200);
    }
    const stillFull = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Another", key: "FFF" });
    expect(stillFull.status).toBe(409);

    const deleted = await request(app)
      .delete(`/api/orgs/${orgId}/projects/${ids[2]}`)
      .set(auth(admin.token));
    expect(deleted.status).toBe(200);

    // Two active projects left: one more fits within Free, then it is full.
    const within = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Another", key: "FFF" });
    expect(within.status).toBe(201);
    const full = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Third", key: "GGG" });
    expect(full.status).toBe(409);
  });

  it("blocks new and reopened tasks at the limit but keeps edit, complete and delete", async () => {
    const { orgId, admin } = await proOrg("grace6.test");
    const projectId = await project(orgId, admin.token, "AAA");
    const ids: string[] = [];
    for (let n = 0; n < 12; n += 1) {
      ids.push(await task(orgId, admin.token, projectId, n));
    }
    await expireAgo(orgId, 5);
    const create = () =>
      request(app)
        .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
        .set(auth(admin.token))
        .send({ title: "One more" });

    const blocked = await create();
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_GRACE_RESTRICTED");

    const edit = await request(app)
      .patch(`/api/orgs/${orgId}/tasks/${ids[5]}`)
      .set(auth(admin.token))
      .send({ title: "Renamed" });
    expect(edit.status).toBe(200);

    // Completing is allowed, but 11 open tasks is still over Free.
    expect((await status(orgId, admin.token, ids[0]!, "done")).status).toBe(
      200,
    );
    expect((await create()).status).toBe(403);
    const reopened = await status(orgId, admin.token, ids[0]!, "todo");
    expect(reopened.status).toBe(400);
    expect(reopened.body.error.code).toBe("TASK_LIMIT_REACHED");

    for (const id of [ids[1]!, ids[2]!]) {
      const deleted = await request(app)
        .delete(`/api/orgs/${orgId}/tasks/${id}`)
        .set(auth(admin.token));
      expect(deleted.status).toBe(204);
    }
    // 9 open tasks: room for exactly one more.
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(400);
  });

  it("won't restore a project whose open tasks don't fit the plan", async () => {
    const { orgId, admin } = await proOrg("grace7.test");
    const projectId = await project(orgId, admin.token, "AAA");
    for (let n = 0; n < 12; n += 1)
      await task(orgId, admin.token, projectId, n);
    const archived = await request(app)
      .post(`/api/orgs/${orgId}/projects/${projectId}/archive`)
      .set(auth(admin.token));
    expect(archived.status).toBe(200);
    await expireAgo(orgId, 5);

    const refused = await request(app)
      .post(`/api/orgs/${orgId}/projects/${projectId}/unarchive`)
      .set(auth(admin.token));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("TASK_LIMIT_REACHED");

    await Organization.updateOne(
      { _id: orgId },
      { plan: "pro", seatLimit: 30, projectLimit: 25 },
    );
    const restored = await request(app)
      .post(`/api/orgs/${orgId}/projects/${projectId}/unarchive`)
      .set(auth(admin.token));
    expect(restored.status).toBe(200);
  });
});

describe("what the grace period leaves alone", () => {
  it("doesn't archive tasks inside an already archived project", async () => {
    const { orgId, admin } = await proOrg("grace8.test");
    const projectId = await project(orgId, admin.token, "AAA");
    for (let n = 0; n < 14; n += 1)
      await task(orgId, admin.token, projectId, n);
    const archived = await request(app)
      .post(`/api/orgs/${orgId}/projects/${projectId}/archive`)
      .set(auth(admin.token));
    expect(archived.status).toBe(200);
    await expireAgo(orgId, 12);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.status).toBe(200);
    expect(
      await Task.countDocuments({ archivedAt: { $ne: null } }).setOptions({
        skipTenant: true,
      }),
    ).toBe(0);
    expect((await Organization.findById(orgId).lean())?.graceArchived).toEqual({
      projects: 0,
      tasks: 0,
    });
    // An archived project isn't in use, so it doesn't pause the account.
    expect(org.body.usage.overLimit).toBe(false);
    expect(org.body.usage.paused).toBe(false);
  });

  it("doesn't archive tasks inside a project it archives for the plan", async () => {
    const { orgId, admin } = await proOrg("grace9.test");
    const ids: string[] = [];
    for (const key of ["AAA", "BBB", "CCC", "DDD"]) {
      ids.push(await project(orgId, admin.token, key));
    }
    // The least recently active project has the most open tasks.
    for (let n = 0; n < 12; n += 1) await task(orgId, admin.token, ids[3]!, n);
    for (const [i, id] of ids.entries()) {
      await Project.collection.updateOne(
        { _id: oid(id) },
        { $set: { updatedAt: ago(i + 20) } },
      );
    }
    await Task.collection.updateMany(
      { projectId: oid(ids[3]!) },
      { $set: { updatedAt: ago(40) } },
    );
    await expireAgo(orgId, 12);

    await request(app).get(`/api/orgs/${orgId}`).set(auth(admin.token));
    const archived = await Project.find({
      archivedAt: { $ne: null },
    }).setOptions({ skipTenant: true });
    expect(archived.map((p) => p.key)).toEqual(["DDD"]);
    expect(
      await Task.countDocuments({ archivedAt: { $ne: null } }).setOptions({
        skipTenant: true,
      }),
    ).toBe(0);
  });

  it("never removes members, and stays paused over the seat limit", async () => {
    const { orgId, admin } = await proOrg("grace10.test");
    await expireAgo(orgId, 12);
    // More seats in use than Free allows.
    await Organization.updateOne({ _id: orgId }, { seatsUsed: 8 });
    const before = await Membership.countDocuments({
      tenantId: orgId,
    }).setOptions({ skipTenant: true });

    const blocked = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Blocked", key: "AAA" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_OVER_LIMIT");
    expect(
      await Membership.countDocuments({ tenantId: orgId }).setOptions({
        skipTenant: true,
      }),
    ).toBe(before);
  });
});

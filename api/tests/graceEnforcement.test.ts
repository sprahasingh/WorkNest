import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Project } from "../src/models/Project.js";
import { Task } from "../src/models/Task.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const oid = (id: string) => new mongoose.Types.ObjectId(id);

async function proOrg(domain: string) {
  const { orgId, admin } = await setupOrg(app, domain);
  await Organization.updateOne(
    { _id: orgId },
    { plan: "pro", seatLimit: 30, projectLimit: 25 },
  );
  const api = (method: "get" | "post" | "patch" | "delete", path: string) =>
    request(app)[method](`/api/orgs/${orgId}${path}`).set(auth(admin.token));

  async function project(key: string, tasks = 0) {
    const created = await api("post", "/projects").send({
      name: `Project ${key}`,
      key,
    });
    expect(created.status).toBe(201);
    const id = created.body.project._id as string;
    const taskIds: string[] = [];
    for (let n = 0; n < tasks; n += 1) {
      const task = await api("post", `/projects/${id}/tasks`).send({
        title: `Task ${n}`,
      });
      expect(task.status).toBe(201);
      taskIds.push(task.body.task._id as string);
    }
    return { id, taskIds };
  }

  // The plan ended `days` ago; the workspace is on Free.
  const expireAgo = (days: number, extra: object = {}) =>
    Organization.updateOne(
      { _id: orgId },
      {
        plan: "free",
        seatLimit: 5,
        projectLimit: 3,
        planExpiredAt: new Date(Date.now() - days * DAY),
        planExpiredFrom: "pro",
        graceEnforcedAt: null,
        graceEnforcingAt: null,
        ...extra,
      },
    );
  const archivedProjects = () =>
    Project.countDocuments({ archivedAt: { $ne: null } }).setOptions({
      skipTenant: true,
    });
  return { orgId, api, project, expireAgo, archivedProjects };
}

describe("during the grace period", () => {
  it("blocks adding anything while over the limits, until usage comes down", async () => {
    const t = await proOrg("ge1.test");
    const crowded = await t.project("AAA", 12);
    const other = await t.project("BBB", 3);
    await t.expireAgo(5);

    const create = (projectId: string) =>
      t.api("post", `/projects/${projectId}/tasks`).send({ title: "New" });

    // One project is over, so a task can't be added even to the other one.
    const blocked = await create(other.id);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_GRACE_RESTRICTED");
    const org = await t.api("get", "");
    expect(org.body.usage.restricted).toBe(true);
    expect(org.body.usage.paused).toBe(false);

    // Open tasks can be archived, which is how usage comes down.
    for (const id of crowded.taskIds.slice(0, 2)) {
      const archived = await t.api("patch", `/tasks/${id}/archive`);
      expect(archived.status).toBe(200);
      expect(archived.body.task.archivedAt).not.toBeNull();
    }
    // Back at 10 open tasks: within Free, so adding is allowed again where
    // there is room, and still refused where the project is full.
    expect((await create(other.id)).status).toBe(201);
    const full = await create(crowded.id);
    expect(full.status).toBe(400);
    expect(full.body.error.code).toBe("TASK_LIMIT_REACHED");

    // An archived open task comes back only when there is room.
    const restore = await t.api(
      "patch",
      `/tasks/${crowded.taskIds[0]}/unarchive`,
    );
    expect(restore.status).toBe(400);
    expect(restore.body.error.code).toBe("TASK_LIMIT_REACHED");
  });
});

describe("after the grace period", () => {
  it("archives the extras on the first request instead of blocking it", async () => {
    const t = await proOrg("ge2.test");
    for (const key of ["AAA", "BBB", "CCC", "DDD", "EEE"]) {
      await t.project(key, 1);
    }
    await t.expireAgo(11);

    // The first requests after the 10 days.
    const listed = await t.api("get", "/projects");
    expect(listed.status).toBe(200);
    const create = await t
      .api("post", "/projects")
      .send({ name: "More", key: "FFF" });
    // Not blocked as paused or restricted: archived down to the 3 Free slots,
    // and those are all in use.
    expect(create.status).toBe(409);
    expect(create.body.error.code).toBe("PROJECT_LIMIT_REACHED");
    expect(await t.archivedProjects()).toBe(2);

    const org = await Organization.findById(t.orgId).lean();
    expect(org?.graceEnforcedAt).not.toBeNull();
    expect(org?.graceEnforcingAt).toBeNull();
    expect(org?.graceArchived).toEqual({ projects: 2, tasks: 0 });
    const usage = (await t.api("get", "")).body.usage;
    expect(usage.paused).toBe(false);
    expect(usage.restricted).toBe(false);
  });

  it("never mistakes archiving that is still running for a paused account", async () => {
    const t = await proOrg("ge3.test");
    const first = await t.project("AAA", 1);
    for (const key of ["BBB", "CCC", "DDD", "EEE"]) await t.project(key, 1);
    // Another request holds the archiving right now.
    await t.expireAgo(11, { graceEnforcingAt: new Date() });

    const blocked = await t
      .api("post", "/projects")
      .send({ name: "More", key: "FFF" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_GRACE_RESTRICTED");
    // Editing still works.
    const edit = await t
      .api("patch", `/projects/${first.id}`)
      .send({ name: "Renamed" });
    expect(edit.status).toBe(200);
    expect(await t.archivedProjects()).toBe(0);
  });

  it("finishes archiving that was marked done while still over", async () => {
    const t = await proOrg("ge4.test");
    const first = await t.project("AAA", 1);
    for (const key of ["BBB", "CCC", "DDD", "EEE"]) await t.project(key, 1);
    await t.expireAgo(11, { graceEnforcedAt: new Date() });

    const edit = await t
      .api("patch", `/projects/${first.id}`)
      .send({ name: "Renamed" });
    expect(edit.status).toBe(200);
    expect(await t.archivedProjects()).toBe(2);
    const org = await Organization.findById(t.orgId).lean();
    expect(org?.projectCount).toBe(3);
    expect(org?.graceArchived?.projects).toBe(2);
  });

  it("trims open tasks in projects that stay, even with odd data", async () => {
    const t = await proOrg("ge5.test");
    const { id, taskIds } = await t.project("AAA", 12);
    // A task from before timestamps were kept.
    await Task.collection.updateOne(
      { _id: oid(taskIds[0]!) },
      { $unset: { updatedAt: "" } },
    );
    await t.expireAgo(11);

    const usage = (await t.api("get", "")).body.usage;
    expect(usage.paused).toBe(false);
    expect(usage.overLimit).toBe(false);
    const open = await Task.countDocuments({
      projectId: id,
      archivedAt: null,
    }).setOptions({ skipTenant: true });
    expect(open).toBe(10);
  });
});

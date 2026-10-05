import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { countProjectsOverTaskLimit } from "../src/modules/billing/taskUsage.js";
import { runWithTenant } from "../src/tenancy/context.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const FREE_TASK_LIMIT = 10;

// A Premium workspace (no task limit), so projects can hold more open tasks
// than Free allows.
async function premiumOrg(domain: string) {
  const { orgId, admin } = await setupOrg(app, domain);
  await Organization.updateOne(
    { _id: orgId },
    { plan: "premium", seatLimit: 100, projectLimit: 50 },
  );
  const api = (method: "post" | "patch" | "delete", path: string) =>
    request(app)[method](`/api/orgs/${orgId}${path}`).set(auth(admin.token));

  async function project(key: string, openTasks: number, doneTasks = 0) {
    const created = await api("post", "/projects").send({
      name: `Project ${key}`,
      key,
    });
    expect(created.status).toBe(201);
    const id = created.body.project._id as string;
    for (let n = 0; n < openTasks + doneTasks; n += 1) {
      const task = await api("post", `/projects/${id}/tasks`).send({
        title: `Task ${n}`,
      });
      expect(task.status).toBe(201);
      if (n < doneTasks) {
        const done = await api("patch", `/tasks/${task.body.task._id}`).send({
          status: "done",
        });
        expect(done.status).toBe(200);
      }
    }
    return id;
  }

  const overTheLimit = () =>
    runWithTenant({ tenantId: orgId, userId: admin.id, role: "admin" }, () =>
      countProjectsOverTaskLimit(FREE_TASK_LIMIT),
    );

  // What the downgrade check says: how many projects it counts as over the
  // limit, whether or not it lets the plan change go through.
  async function downgradeCount(): Promise<number> {
    const res = await api("post", "/plan").send({ plan: "free" });
    if (res.status === 200) return 0;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_DOWNGRADE_BLOCKED");
    return res.body.error.details[0].projectsOverTaskLimit as number;
  }

  // What the check after a plan ends says: the workspace is on Free with the
  // grace period running, and the usage report counts the same projects.
  async function graceCount(): Promise<number> {
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "free",
        seatLimit: 5,
        projectLimit: 3,
        planExpiredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        planExpiredFrom: "premium",
        graceEnforcedAt: null,
      },
    );
    const usage = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(usage.status).toBe(200);
    return usage.body.usage.projectsOverTaskLimit as number;
  }

  return { orgId, api, project, overTheLimit, downgradeCount, graceCount };
}

describe("one task-limit rule for downgrades and the grace period", () => {
  it("counts open tasks in an active project", async () => {
    const t = await premiumOrg("tl1.test");
    await t.project("AAA", FREE_TASK_LIMIT + 1);
    expect(await t.overTheLimit()).toBe(1);
    expect(await t.downgradeCount()).toBe(1);
    expect(await t.graceCount()).toBe(1);
  });

  it("doesn't count open tasks in an archived project", async () => {
    const t = await premiumOrg("tl2.test");
    const id = await t.project("AAA", FREE_TASK_LIMIT + 1);
    expect((await t.api("post", `/projects/${id}/archive`)).status).toBe(200);
    expect(await t.overTheLimit()).toBe(0);
    expect(await t.downgradeCount()).toBe(0);
    expect(await t.graceCount()).toBe(0);
  });

  it("counts only the active project when one is active and one archived", async () => {
    const t = await premiumOrg("tl3.test");
    await t.project("AAA", FREE_TASK_LIMIT + 1);
    const archived = await t.project("BBB", FREE_TASK_LIMIT + 1);
    expect((await t.api("post", `/projects/${archived}/archive`)).status).toBe(
      200,
    );
    expect(await t.overTheLimit()).toBe(1);
    expect(await t.downgradeCount()).toBe(1);
    expect(await t.graceCount()).toBe(1);
  });

  it("doesn't count a binned project, tasks at the limit, or finished tasks", async () => {
    const t = await premiumOrg("tl4.test");
    // Exactly at the limit: fine.
    await t.project("AAA", FREE_TASK_LIMIT);
    // Plenty of tasks, but 3 of 12 are done, leaving 9 open: fine.
    await t.project("BBB", FREE_TASK_LIMIT - 1, 3);
    const binned = await t.project("CCC", FREE_TASK_LIMIT + 1);
    expect((await t.api("delete", `/projects/${binned}`)).status).toBe(200);
    expect(await t.overTheLimit()).toBe(0);
    expect(await t.downgradeCount()).toBe(0);
    expect(await t.graceCount()).toBe(0);
  });
});

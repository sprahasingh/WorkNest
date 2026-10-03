import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Task } from "../src/models/Task.js";
import { AuditLog } from "../src/models/AuditLog.js";
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

async function createTask(
  orgId: string,
  projectId: string,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Task", ...overrides });
  return res.body.task._id as string;
}

async function updateTask(
  orgId: string,
  taskId: string,
  token: string,
  input: Record<string, unknown>,
) {
  return request(app)
    .patch(`/api/orgs/${orgId}/tasks/${taskId}`)
    .set("Authorization", `Bearer ${token}`)
    .send(input);
}

describe("dashboard aggregation", () => {
  it("matches a known fixture of tasks by status, priority, overdue, and usage", async () => {
    const org = await registerOrg(
      "dash-fixture@example.com",
      "Dash Fixture Org",
    );
    const projectId = await createProject(org.orgId, org.accessToken, "DSH");

    await createTask(org.orgId, projectId, org.accessToken, {
      priority: "low",
    });

    const inProgressId = await createTask(
      org.orgId,
      projectId,
      org.accessToken,
      { priority: "high" },
    );
    await updateTask(org.orgId, inProgressId, org.accessToken, {
      status: "in_progress",
    });

    const doneId = await createTask(org.orgId, projectId, org.accessToken, {
      priority: "high",
    });
    await updateTask(org.orgId, doneId, org.accessToken, { status: "done" });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await createTask(org.orgId, projectId, org.accessToken, {
      priority: "medium",
      dueDate: yesterday,
    });

    // Past-due tasks that are already done must not count as overdue.
    const overdueButDoneId = await createTask(
      org.orgId,
      projectId,
      org.accessToken,
      { priority: "medium", dueDate: yesterday },
    );
    await updateTask(org.orgId, overdueButDoneId, org.accessToken, {
      status: "done",
    });

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .set("Authorization", `Bearer ${org.accessToken}`);

    expect(res.status).toBe(200);

    const statusCounts = Object.fromEntries(
      res.body.tasksByStatus.map((s: { _id: string; count: number }) => [
        s._id,
        s.count,
      ]),
    );
    expect(statusCounts.todo).toBe(2);
    expect(statusCounts.in_progress).toBe(1);
    expect(statusCounts.done).toBe(2);

    const priorityCounts = Object.fromEntries(
      res.body.tasksByPriority.map((p: { _id: string; count: number }) => [
        p._id,
        p.count,
      ]),
    );
    expect(priorityCounts.low).toBe(1);
    expect(priorityCounts.high).toBe(2);
    expect(priorityCounts.medium).toBe(2);

    expect(res.body.overdueCount).toBe(1);

    expect(res.body.tasksCreatedPerDay).toHaveLength(14);
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = res.body.tasksCreatedPerDay.find(
      (d: { date: string; count: number }) => d.date === today,
    );
    expect(todayEntry?.count).toBe(5);

    expect(res.body.usage).toMatchObject({
      seatsUsed: 1,
      seatLimit: 5,
      memberCount: 1,
      projectCount: 1,
      projectLimit: 3,
    });
  });

  it("ranks top assignees by open task count, excluding done tasks", async () => {
    const org = await registerOrg("dash-assignees@example.com", "Assignee Org");
    const projectId = await createProject(org.orgId, org.accessToken, "ASG");

    await createTask(org.orgId, projectId, org.accessToken, {
      assigneeIds: [org.userId],
    });
    await createTask(org.orgId, projectId, org.accessToken, {
      assigneeIds: [org.userId],
    });

    const doneAssignedId = await createTask(
      org.orgId,
      projectId,
      org.accessToken,
      { assigneeIds: [org.userId] },
    );
    await updateTask(org.orgId, doneAssignedId, org.accessToken, {
      status: "done",
    });

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .set("Authorization", `Bearer ${org.accessToken}`);

    expect(res.body.topAssignees).toHaveLength(1);
    expect(res.body.topAssignees[0]).toMatchObject({
      userId: org.userId,
      openTaskCount: 2,
    });
  });
});

describe("dashboard trend range", () => {
  it("covers everything since the org started for days=all, grouping long spans by week", async () => {
    const org = await registerOrg("dash-all-time@example.com", "All Time Org");
    const projectId = await createProject(org.orgId, org.accessToken, "ALL");
    await createTask(org.orgId, projectId, org.accessToken);
    const auth = { Authorization: `Bearer ${org.accessToken}` };
    const today = new Date().toISOString().slice(0, 10);

    const young = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: "all" })
      .set(auth);
    expect(young.status).toBe(200);
    expect(young.body.trend).toMatchObject({
      granularity: "day",
      since: today,
      total: 1,
    });
    expect(young.body.tasksCreatedPerDay).toEqual([{ date: today, count: 1 }]);

    // An older task (e.g. imported) stretches "all time" back to its day.
    const oldTaskId = await createTask(org.orgId, projectId, org.accessToken);
    const longAgo = new Date();
    longAgo.setUTCDate(longAgo.getUTCDate() - 200);
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(oldTaskId) },
      { $set: { createdAt: longAgo } },
    );

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: "all" })
      .set(auth);
    expect(res.body.trend).toMatchObject({
      granularity: "week",
      since: longAgo.toISOString().slice(0, 10),
      total: 2,
    });
    const points = res.body.tasksCreatedPerDay as Array<{
      date: string;
      count: number;
    }>;
    expect(points.length).toBeGreaterThanOrEqual(29);
    expect(points.length).toBeLessThanOrEqual(31);
    expect(points.reduce((sum, p) => sum + p.count, 0)).toBe(2);
    // Every point is a Monday.
    expect(points.every((p) => new Date(p.date).getUTCDay() === 1)).toBe(true);

    const lastWeek = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: 7 })
      .set(auth);
    expect(lastWeek.body.trend).toMatchObject({ granularity: "day", total: 1 });
    expect(lastWeek.body.tasksCreatedPerDay).toHaveLength(7);
  });
});

describe("dashboard trend days and comparison", () => {
  it("counts days in the viewer's time zone and compares with the previous period", async () => {
    const org = await registerOrg("dash-tz@example.com", "Time Zone Org");
    const projectId = await createProject(org.orgId, org.accessToken, "TZ");
    const auth = { Authorization: `Bearer ${org.accessToken}` };

    // 22:00 UTC three days ago is already the next day in India (+5:30).
    const late = new Date();
    late.setUTCDate(late.getUTCDate() - 3);
    late.setUTCHours(22, 0, 0, 0);
    const lateTask = await createTask(org.orgId, projectId, org.accessToken);
    // And one from ten days ago, before a 7-day window.
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 10);
    old.setUTCHours(12, 0, 0, 0);
    const oldTask = await createTask(org.orgId, projectId, org.accessToken);
    for (const [id, createdAt] of [
      [lateTask, late],
      [oldTask, old],
    ] as const) {
      await Task.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { createdAt } },
      );
    }

    const dayAfter = new Date(late);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const utcKey = late.toISOString().slice(0, 10);
    const indiaKey = dayAfter.toISOString().slice(0, 10);

    const countOn = (
      points: Array<{ date: string; count: number }>,
      key: string,
    ) => points.find((p) => p.date === key)?.count ?? 0;

    const inUtc = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: 7, tz: "UTC" })
      .set(auth);
    expect(countOn(inUtc.body.tasksCreatedPerDay, utcKey)).toBe(1);

    const inIndia = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: 7, tz: "Asia/Kolkata" })
      .set(auth);
    expect(countOn(inIndia.body.tasksCreatedPerDay, indiaKey)).toBe(1);
    expect(countOn(inIndia.body.tasksCreatedPerDay, utcKey)).toBe(0);
    expect(inIndia.body.trend).toMatchObject({
      timeZone: "Asia/Kolkata",
      total: 1,
      previousTotal: 1,
    });

    // An unknown time zone falls back to UTC instead of failing.
    const bogus = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: 7, tz: "Not/AZone" })
      .set(auth);
    expect(bogus.status).toBe(200);
    expect(bogus.body.trend.timeZone).toBe("UTC");

    const allTime = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: "all", tz: "UTC" })
      .set(auth);
    expect(allTime.body.trend.previousTotal).toBeNull();
    expect(allTime.body.trend.total).toBe(2);
  });
});

describe("dashboard custom range", () => {
  it("covers exactly the chosen days, in either order, never past today", async () => {
    const org = await registerOrg("dash-custom@example.com", "Custom Org");
    const projectId = await createProject(org.orgId, org.accessToken, "CUS");
    const auth = { Authorization: `Bearer ${org.accessToken}` };

    const daysAgo = (n: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - n);
      date.setUTCHours(12, 0, 0, 0);
      return date;
    };
    const key = (n: number) => daysAgo(n).toISOString().slice(0, 10);

    for (const n of [10, 5, 1]) {
      const id = await createTask(org.orgId, projectId, org.accessToken);
      await Task.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { createdAt: daysAgo(n) } },
      );
    }

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ from: key(12), to: key(4), tz: "UTC" })
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.trend).toMatchObject({
      granularity: "day",
      since: key(12),
      until: key(4),
      total: 2,
      previousTotal: 0,
    });
    expect(res.body.tasksCreatedPerDay).toHaveLength(9);

    const swapped = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ from: key(4), to: key(12), tz: "UTC" })
      .set(auth);
    expect(swapped.body.trend).toMatchObject({ since: key(12), until: key(4) });

    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 30);
    const clamped = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ from: key(2), to: future.toISOString().slice(0, 10), tz: "UTC" })
      .set(auth);
    expect(clamped.body.trend.until).toBe(key(0));
    expect(clamped.body.trend.total).toBe(1);
  });
});

describe("cross-tenant dashboard isolation", () => {
  it("never counts another org's tasks or projects", async () => {
    const orgA = await registerOrg("dash-a@example.com", "Dash Org A");
    const orgB = await registerOrg("dash-b@example.com", "Dash Org B");

    const projectA = await createProject(orgA.orgId, orgA.accessToken, "DA");
    const projectB = await createProject(orgB.orgId, orgB.accessToken, "DB");

    await createTask(orgA.orgId, projectA, orgA.accessToken);

    for (let i = 0; i < 5; i++) {
      await createTask(orgB.orgId, projectB, orgB.accessToken);
    }

    const dashA = await request(app)
      .get(`/api/orgs/${orgA.orgId}/dashboard`)
      .set("Authorization", `Bearer ${orgA.accessToken}`);

    const totalA = dashA.body.tasksByStatus.reduce(
      (sum: number, s: { count: number }) => sum + s.count,
      0,
    );
    expect(totalA).toBe(1);
    expect(dashA.body.usage.projectCount).toBe(1);
  });
});

describe("dashboard status history and workload", () => {
  it("rebuilds open tasks per day and counts tasks marked done each day", async () => {
    const org = await registerOrg("dash-history@example.com", "History Org");
    const projectId = await createProject(org.orgId, org.accessToken, "HS");
    const auth = { Authorization: `Bearer ${org.accessToken}` };
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

    const taskA = await createTask(org.orgId, projectId, org.accessToken, {
      assigneeIds: [org.userId],
    });
    const taskB = await createTask(org.orgId, projectId, org.accessToken);
    await createTask(org.orgId, projectId, org.accessToken, {
      priority: "high",
      dueDate: daysAgo(-3).toISOString(),
    });
    await Task.collection.updateMany(
      { projectId: new mongoose.Types.ObjectId(projectId) },
      { $set: { createdAt: daysAgo(5) } },
    );

    // A: started three days ago, finished yesterday. B: finished today.
    await updateTask(org.orgId, taskA, org.accessToken, {
      status: "in_progress",
    });
    await updateTask(org.orgId, taskA, org.accessToken, { status: "done" });
    await updateTask(org.orgId, taskB, org.accessToken, { status: "done" });
    const changesA = await AuditLog.find({
      action: "task.updated",
      entityId: new mongoose.Types.ObjectId(taskA),
    }).sort({ createdAt: 1, _id: 1 });
    await AuditLog.collection.updateOne(
      { _id: changesA[0]._id },
      { $set: { createdAt: daysAgo(3) } },
    );
    await AuditLog.collection.updateOne(
      { _id: changesA[1]._id },
      { $set: { createdAt: daysAgo(1) } },
    );

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/dashboard`)
      .query({ days: 7, tz: "UTC" })
      .set(auth);
    expect(res.status).toBe(200);
    const history = res.body.statusHistory as Array<{
      todo: number;
      in_progress: number;
      done: number;
    }>;
    expect(history).toHaveLength(7);
    const counts = history.map((point) => [
      point.todo,
      point.in_progress,
      point.done,
    ]);
    // [to do, in progress] at the end of each day, then marked done that day.
    expect(counts).toEqual([
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 0],
      [2, 1, 0],
      [2, 1, 0],
      [2, 0, 1],
      [1, 0, 1],
    ]);

    expect(res.body.completed.total).toBe(2);
    expect(res.body.completed.previousTotal).toBe(0);
    expect(res.body.dueSoonCount).toBe(1);
    expect(res.body.unassignedOpenCount).toBe(1);
    expect(res.body.openByPriority).toEqual([{ _id: "high", count: 1 }]);
    expect(res.body.projectProgress[0]).toMatchObject({
      projectId,
      total: 3,
      todo: 1,
      inProgress: 0,
      done: 2,
      open: 1,
      createdInRange: 3,
      completedInRange: 2,
    });
    expect(res.body.archivedProjectCount).toBe(0);
  });
});

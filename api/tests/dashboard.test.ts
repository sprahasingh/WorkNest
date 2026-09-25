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

    const yesterday = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();

    await createTask(org.orgId, projectId, org.accessToken, {
      priority: "medium",
      dueDate: yesterday,
    });

    // Overdue-looking (past due date) but already done — must not count as overdue.
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
    const org = await registerOrg(
      "dash-assignees@example.com",
      "Assignee Org",
    );
    const projectId = await createProject(org.orgId, org.accessToken, "ASG");

    await createTask(org.orgId, projectId, org.accessToken, {
      assigneeId: org.userId,
    });
    await createTask(org.orgId, projectId, org.accessToken, {
      assigneeId: org.userId,
    });

    const doneAssignedId = await createTask(
      org.orgId,
      projectId,
      org.accessToken,
      { assigneeId: org.userId },
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

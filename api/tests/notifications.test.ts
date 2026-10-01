import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Membership } from "../src/models/Membership.js";
import { Notification } from "../src/models/Notification.js";
import { migrateDateOnlyTaskDueDates } from "../src/db/migrations.js";
import { ensureDueNotificationsForAllUsers } from "../src/modules/notifications/notifications.service.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const response = await registerAndVerify(app, {
    name: "Admin User",
    email,
    password: "password123",
    orgName,
  });
  const accessToken = response.body.accessToken as string;
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
  await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email, role });
  const token = takeInvitationToken(email);
  const signup = await signupInviteAndVerify(app, token, email, {
    name: email,
    password: "password123",
  });
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);

  return { accessToken, userId: me.body.user.id as string };
}

async function createProject(orgId: string, token: string, key: string) {
  const response = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${key}`, key });
  return response.body.project._id as string;
}

async function createTask(
  orgId: string,
  projectId: string,
  token: string,
  input: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Notification task", ...input });
}

async function getUnread(orgId: string, token: string) {
  return request(app)
    .get(`/api/orgs/${orgId}/notifications`)
    .query({ status: "unread" })
    .set("Authorization", `Bearer ${token}`);
}

describe("task notifications", () => {
  it("notifies only newly assigned members", async () => {
    const admin = await registerOrg(
      "task-assignment-alert-admin@example.com",
      "Task Assignment Alert Org",
    );
    const firstAssignee = await addMember(
      admin.orgId,
      admin.accessToken,
      "task-assignment-first@example.com",
    );
    const secondAssignee = await addMember(
      admin.orgId,
      admin.accessToken,
      "task-assignment-second@example.com",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "TA");
    const created = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { assigneeIds: [firstAssignee.userId] },
    );
    const initialFirstNotifications = await getUnread(
      admin.orgId,
      firstAssignee.accessToken,
    );
    expect(initialFirstNotifications.body.notifications).toEqual([
      expect.objectContaining({
        taskId: created.body.task._id,
        type: "task_assigned",
      }),
    ]);

    const reassigned = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${created.body.task._id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ assigneeIds: [firstAssignee.userId, secondAssignee.userId] });
    expect(reassigned.status).toBe(200);

    const firstNotifications = await getUnread(
      admin.orgId,
      firstAssignee.accessToken,
    );
    expect(firstNotifications.body.notifications).toHaveLength(1);
    expect(firstNotifications.body.notifications[0]._id).toBe(
      initialFirstNotifications.body.notifications[0]._id,
    );
    const secondNotifications = await getUnread(
      admin.orgId,
      secondAssignee.accessToken,
    );
    expect(secondNotifications.body.notifications).toEqual([
      expect.objectContaining({
        taskId: created.body.task._id,
        type: "task_assigned",
        message: 'Admin User assigned "Notification task" to you',
      }),
    ]);
  });

  it("replaces the 48-hour reminder with a due-today reminder at local midnight", async () => {
    const admin = await registerOrg("reminders@example.com", "Reminder Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "RM");
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const taskWith48HourReminder = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [admin.userId],
        dueDate,
      },
    );

    const firstRead = await getUnread(admin.orgId, admin.accessToken);
    const firstReminder = firstRead.body.notifications.find(
      (item: { taskId: string; type: string }) =>
        item.taskId === taskWith48HourReminder.body.task._id &&
        item.type === "task_due_soon",
    );
    expect(firstReminder.eventKey).toMatch(/:48h$/);

    const taskWithout48HourReminder = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { assigneeIds: [admin.userId], dueDate },
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${dueDate}T00:00:00.000Z`));
    try {
      await ensureDueNotificationsForAllUsers();
    } finally {
      vi.useRealTimers();
    }

    const reminders = await Notification.find({
      tenantId: admin.orgId,
      userId: admin.userId,
      type: "task_due_soon",
    }).lean();
    const previousReminder = reminders.find(
      (item) => item._id.toString() === firstReminder._id,
    );
    expect(previousReminder?.dismissedAt).toBeTruthy();

    for (const taskId of [
      taskWith48HourReminder.body.task._id,
      taskWithout48HourReminder.body.task._id,
    ]) {
      const dueTodayReminder = reminders.find(
        (item) =>
          item.taskId?.toString() === taskId &&
          !item.eventKey?.endsWith(":48h"),
      );
      expect(dueTodayReminder?.message).toBe(
        'Task "Notification task" is due today',
      );
      expect(dueTodayReminder?.dismissedAt).toBeNull();
    }

    expect(
      reminders.some(
        (item) =>
          item.taskId?.toString() === taskWithout48HourReminder.body.task._id &&
          item.eventKey?.endsWith(":48h"),
      ),
    ).toBe(false);
  });

  it("starts a fresh reminder cycle when a completed task is reopened", async () => {
    const admin = await registerOrg(
      "reopen-reminder@example.com",
      "Reopen Reminder Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "RO");
    const created = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [admin.userId],
        dueDate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      },
    );
    const taskId = created.body.task._id as string;

    const initial = await getUnread(admin.orgId, admin.accessToken);
    expect(initial.body.notifications).toHaveLength(1);

    const completed = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "done" });
    expect(completed.status).toBe(200);

    const reopened = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "todo" });
    expect(reopened.status).toBe(200);

    const afterReopen = await getUnread(admin.orgId, admin.accessToken);
    expect(afterReopen.body.notifications).toHaveLength(1);
    expect(
      afterReopen.body.notifications.every(
        (item: { type: string }) => item.type === "task_due_soon",
      ),
    ).toBe(true);
  });

  it("stores a date-only deadline at the end of that date in the org timezone", async () => {
    const admin = await registerOrg(
      "timezone-due-date@example.com",
      "Timezone Due Date Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "TZ");
    const created = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { dueDate: "2026-09-30" },
    );
    expect(created.status).toBe(201);
    expect(created.body.task.dueDate).toBe("2026-09-30T23:59:59.999Z");
    const timedTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { dueDate: "2026-09-30T15:30:00.000Z" },
    );
    expect(timedTask.body.task.dueDateIsDateOnly).toBe(false);

    const timeZoneUpdated = await request(app)
      .patch(`/api/orgs/${admin.orgId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ timeZone: "America/New_York" });
    expect(timeZoneUpdated.status).toBe(200);
    expect(timeZoneUpdated.body.organization.timeZone).toBe("America/New_York");

    const tasks = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(
      tasks.body.items.find(
        (item: { _id: string }) => item._id === created.body.task._id,
      ).dueDate,
    ).toBe("2026-10-01T03:59:59.999Z");
    expect(
      tasks.body.items.find(
        (item: { _id: string }) => item._id === timedTask.body.task._id,
      ).dueDate,
    ).toBe("2026-09-30T15:30:00.000Z");

    const invalidTimeZone = await request(app)
      .patch(`/api/orgs/${admin.orgId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ timeZone: "Mars/Olympus" });
    expect(invalidTimeZone.status).toBe(400);
  });

  it("marks a date-only task overdue only after its selected day ends", async () => {
    const admin = await registerOrg(
      "date-boundary-reminder@example.com",
      "Date Boundary Reminder Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "DB");
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    const yesterdayTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { assigneeIds: [admin.userId], dueDate: yesterday },
    );
    const todayTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { assigneeIds: [admin.userId], dueDate: today },
    );

    const notifications = await getUnread(admin.orgId, admin.accessToken);
    expect(notifications.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: yesterdayTask.body.task._id,
          type: "task_overdue",
        }),
      ]),
    );
    expect(
      notifications.body.notifications.some(
        (item: { taskId: string; type: string }) =>
          item.taskId === todayTask.body.task._id &&
          item.type === "task_overdue",
      ),
    ).toBe(false);
    expect(
      notifications.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === todayTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toHaveLength(1);
  });

  it("replaces a pending due-today reminder with an overdue reminder", async () => {
    const admin = await registerOrg(
      "overdue-replaces-due-today@example.com",
      "Overdue Replaces Due Today Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "OR");
    const dueDate = new Date(Date.now() + 60 * 60 * 1000);
    const created = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { assigneeIds: [admin.userId], dueDate: dueDate.toISOString() },
    );

    const dueToday = await getUnread(admin.orgId, admin.accessToken);
    expect(dueToday.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: created.body.task._id,
          type: "task_due_soon",
        }),
      ]),
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(dueDate.getTime() + 1));
    try {
      await ensureDueNotificationsForAllUsers();
    } finally {
      vi.useRealTimers();
    }

    const reminders = await Notification.find({
      tenantId: admin.orgId,
      userId: admin.userId,
      taskId: created.body.task._id,
    }).lean();
    expect(
      reminders.find((item) => item.type === "task_due_soon")?.dismissedAt,
    ).toBeTruthy();
    expect(
      reminders.find((item) => item.type === "task_overdue")?.dismissedAt,
    ).toBeNull();
    const unread = await getUnread(admin.orgId, admin.accessToken);
    expect(
      unread.body.notifications
        .filter(
          (item: { taskId: string }) => item.taskId === created.body.task._id,
        )
        .map((item: { type: string }) => item.type),
    ).toEqual(["task_overdue"]);
  });

  it("migrates legacy midnight-UTC date-only tasks to end of day", async () => {
    const admin = await registerOrg(
      "legacy-date-reminder@example.com",
      "Legacy Date Reminder Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "LD");
    const created = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        dueDate: "2030-09-30T00:00:00.000Z",
      },
    );
    expect(created.body.task.dueDate).toBe("2030-09-30T00:00:00.000Z");

    await migrateDateOnlyTaskDueDates();

    const tasks = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(tasks.body.items[0].dueDate).toBe("2030-09-30T23:59:59.999Z");
    expect(tasks.body.items[0].dueDateIsDateOnly).toBe(true);
  });

  it("materializes due reminders for every organization member in the sweep", async () => {
    const admin = await registerOrg(
      "scheduled-reminder-admin@example.com",
      "Scheduled Reminder Org",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "scheduled-reminder-manager@example.com",
      "manager",
    );
    const assignee = await addMember(
      admin.orgId,
      admin.accessToken,
      "scheduled-reminder-member@example.com",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "SR");
    const dueSoonTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [assignee.userId],
        dueDate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      },
    );
    const overdueTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { dueDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    );

    await ensureDueNotificationsForAllUsers();

    const memberNotifications = await getUnread(
      admin.orgId,
      assignee.accessToken,
    );
    expect(memberNotifications.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "task_assigned" }),
        expect.objectContaining({ type: "task_due_soon" }),
      ]),
    );
    const managerNotifications = await getUnread(
      admin.orgId,
      manager.accessToken,
    );
    expect(managerNotifications.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: dueSoonTask.body.task._id,
          type: "task_due_soon",
        }),
        expect.objectContaining({
          taskId: overdueTask.body.task._id,
          type: "task_overdue",
        }),
      ]),
    );
  });

  it("hides reminders while a project is archived and restores them when unarchived", async () => {
    const admin = await registerOrg(
      "archive-reminder@example.com",
      "Archive Reminder Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "AR");
    await createTask(admin.orgId, projectId, admin.accessToken, {
      assigneeIds: [admin.userId],
      dueDate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    });

    const initial = await getUnread(admin.orgId, admin.accessToken);
    expect(initial.body.notifications).toHaveLength(1);

    const archived = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/archive`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(archived.status).toBe(200);
    expect(
      (await getUnread(admin.orgId, admin.accessToken)).body.notifications,
    ).toHaveLength(0);

    const unarchived = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/unarchive`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(unarchived.status).toBe(200);
    expect(
      (await getUnread(admin.orgId, admin.accessToken)).body.notifications,
    ).toHaveLength(1);
  });

  it("removes role-only reminders when a member is demoted", async () => {
    const admin = await registerOrg(
      "role-reminder-admin@example.com",
      "Role Reminder Org",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "role-reminder-manager@example.com",
      "manager",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "RL");
    const dueSoonTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString() },
    );
    const assignedDueSoonTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [manager.userId],
        dueDate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      },
    );
    const overdueTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { dueDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    );

    const initial = await getUnread(admin.orgId, manager.accessToken);
    expect(initial.body.notifications).toHaveLength(4);

    const managerMembership = await Membership.findOne({
      tenantId: admin.orgId,
      userId: manager.userId,
    }).setOptions({ skipTenant: true });
    expect(managerMembership).toBeTruthy();

    const demotedToAdmin = await request(app)
      .patch(`/api/orgs/${admin.orgId}/members/${managerMembership!._id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "admin" });
    expect(demotedToAdmin.status).toBe(200);

    const afterManagerDemotion = await getUnread(
      admin.orgId,
      manager.accessToken,
    );
    expect(afterManagerDemotion.body.notifications).toHaveLength(3);
    expect(afterManagerDemotion.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: assignedDueSoonTask.body.task._id,
          type: "task_due_soon",
        }),
        expect.objectContaining({
          taskId: overdueTask.body.task._id,
          type: "task_overdue",
        }),
      ]),
    );
    expect(
      afterManagerDemotion.body.notifications.some(
        (item: { taskId: string }) => item.taskId === dueSoonTask.body.task._id,
      ),
    ).toBe(false);

    const demotedToMember = await request(app)
      .patch(`/api/orgs/${admin.orgId}/members/${managerMembership!._id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "member" });
    expect(demotedToMember.status).toBe(200);

    const afterAdminDemotion = await getUnread(
      admin.orgId,
      manager.accessToken,
    );
    expect(afterAdminDemotion.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: assignedDueSoonTask.body.task._id,
          type: "task_assigned",
        }),
        expect.objectContaining({
          taskId: assignedDueSoonTask.body.task._id,
          type: "task_due_soon",
        }),
      ]),
    );
  });

  it("sends due-soon reminders to managers earlier and overdue reminders to admins and managers", async () => {
    const admin = await registerOrg(
      "reminder-roles-admin@example.com",
      "Reminder Roles Org",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "reminder-roles-manager@example.com",
      "manager",
    );
    const assignee = await addMember(
      admin.orgId,
      admin.accessToken,
      "reminder-roles-assignee@example.com",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "RR");
    const managerWindowTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      },
    );
    const assigneeWindowTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [assignee.userId, manager.userId, admin.userId],
        dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      },
    );
    const overdueTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [assignee.userId],
        dueDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    );
    const unassignedOverdueTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        dueDate: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    );

    const managerNotifications = await getUnread(
      admin.orgId,
      manager.accessToken,
    );
    expect(
      managerNotifications.body.notifications.map(
        (item: { taskId: string; type: string }) => [item.taskId, item.type],
      ),
    ).toEqual(
      expect.arrayContaining([
        [managerWindowTask.body.task._id, "task_due_soon"],
        [assigneeWindowTask.body.task._id, "task_due_soon"],
        [overdueTask.body.task._id, "task_overdue"],
        [unassignedOverdueTask.body.task._id, "task_overdue"],
      ]),
    );
    expect(
      managerNotifications.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === assigneeWindowTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toHaveLength(1);

    const adminNotifications = await getUnread(admin.orgId, admin.accessToken);
    expect(adminNotifications.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: overdueTask.body.task._id,
          type: "task_overdue",
        }),
        expect.objectContaining({
          taskId: unassignedOverdueTask.body.task._id,
          type: "task_overdue",
        }),
      ]),
    );
    const adminDueSoonNotifications =
      adminNotifications.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === assigneeWindowTask.body.task._id &&
          item.type === "task_due_soon",
      );
    expect(adminDueSoonNotifications).toHaveLength(1);
    expect(
      adminNotifications.body.notifications.some(
        (item: { taskId: string; type: string }) =>
          item.taskId === managerWindowTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toBe(false);

    const assigneeNotifications = await getUnread(
      admin.orgId,
      assignee.accessToken,
    );
    const assigneeDueSoonNotifications =
      assigneeNotifications.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === assigneeWindowTask.body.task._id &&
          item.type === "task_due_soon",
      );
    expect(assigneeDueSoonNotifications).toHaveLength(1);
    expect(
      assigneeDueSoonNotifications.some((item: { eventKey: string }) =>
        item.eventKey.endsWith(":48h"),
      ),
    ).toBe(true);
    expect(
      assigneeDueSoonNotifications.some(
        (item: { eventKey: string }) => !item.eventKey.endsWith(":48h"),
      ),
    ).toBe(false);
    expect(assigneeNotifications.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: overdueTask.body.task._id,
          type: "task_overdue",
        }),
      ]),
    );
    expect(
      assigneeNotifications.body.notifications.some(
        (item: { taskId: string; type: string }) =>
          item.taskId === unassignedOverdueTask.body.task._id &&
          item.type === "task_overdue",
      ),
    ).toBe(false);

    const assignUnassignedTask = await request(app)
      .patch(
        `/api/orgs/${admin.orgId}/tasks/${managerWindowTask.body.task._id}`,
      )
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ assigneeIds: [assignee.userId] });
    expect(assignUnassignedTask.status).toBe(200);

    const removePrivilegedAssignees = await request(app)
      .patch(
        `/api/orgs/${admin.orgId}/tasks/${assigneeWindowTask.body.task._id}`,
      )
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ assigneeIds: [assignee.userId] });
    expect(removePrivilegedAssignees.status).toBe(200);

    const managerAfterReassignment = await getUnread(
      admin.orgId,
      manager.accessToken,
    );
    expect(
      managerAfterReassignment.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === managerWindowTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toHaveLength(1);
    expect(
      managerAfterReassignment.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === assigneeWindowTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toHaveLength(1);

    const adminAfterReassignment = await getUnread(
      admin.orgId,
      admin.accessToken,
    );
    expect(
      adminAfterReassignment.body.notifications.some(
        (item: { taskId: string; type: string }) =>
          item.taskId === assigneeWindowTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toBe(false);
    expect(
      adminAfterReassignment.body.notifications.some(
        (item: { taskId: string; type: string }) =>
          item.taskId === unassignedOverdueTask.body.task._id &&
          item.type === "task_overdue",
      ),
    ).toBe(true);

    const assigneeAfterReassignment = await getUnread(
      admin.orgId,
      assignee.accessToken,
    );
    expect(
      assigneeAfterReassignment.body.notifications.filter(
        (item: { taskId: string; type: string }) =>
          item.taskId === managerWindowTask.body.task._id &&
          item.type === "task_due_soon",
      ),
    ).toHaveLength(1);
  });

  it("notifies every other assignee and the org's admins and managers on completion", async () => {
    const admin = await registerOrg(
      "completion-admin@example.com",
      "Completion Org",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "completion-manager@example.com",
      "manager",
    );
    const completingAssignee = await addMember(
      admin.orgId,
      admin.accessToken,
      "completion-one@example.com",
    );
    const otherAssignee = await addMember(
      admin.orgId,
      admin.accessToken,
      "completion-two@example.com",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "CM");
    const created = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        assigneeIds: [completingAssignee.userId, otherAssignee.userId],
      },
    );
    const taskId = created.body.task._id as string;

    const completed = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${completingAssignee.accessToken}`)
      .send({ status: "done" });
    expect(completed.status).toBe(200);

    for (const recipient of [admin, manager, otherAssignee]) {
      const notifications = await getUnread(admin.orgId, recipient.accessToken);
      expect(notifications.body.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId,
            type: "task_completed",
          }),
        ]),
      );
      expect(notifications.body.unreadCount).toBe(
        recipient.userId === otherAssignee.userId ? 2 : 1,
      );
    }

    const actorNotifications = await getUnread(
      admin.orgId,
      completingAssignee.accessToken,
    );
    expect(actorNotifications.body.notifications).toEqual([
      expect.objectContaining({
        taskId,
        type: "task_assigned",
      }),
    ]);

    await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${completingAssignee.accessToken}`)
      .send({ status: "done" });
    const afterRepeatedUpdate = await getUnread(
      admin.orgId,
      otherAssignee.accessToken,
    );
    expect(afterRepeatedUpdate.body.unreadCount).toBe(2);
  });
});

describe("project due reminders", () => {
  it("notifies every org member when a project is due soon", async () => {
    const admin = await registerOrg(
      "project-due-soon-admin@example.com",
      "Project Due Soon Org",
    );
    const member = await addMember(
      admin.orgId,
      admin.accessToken,
      "project-due-soon-member@example.com",
    );
    const dueDate = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Upcoming project", key: "UP", dueDate });
    const projectId = created.body.project._id as string;

    for (const recipient of [admin, member]) {
      const reminders = await getUnread(admin.orgId, recipient.accessToken);
      expect(reminders.body.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId,
            taskId: null,
            type: "project_due_soon",
            message: 'Project "Upcoming project" is due soon',
          }),
        ]),
      );
    }
  });

  it("notifies every org member when a project is overdue", async () => {
    const admin = await registerOrg(
      "project-reminder-admin@example.com",
      "Project Reminder Org",
    );
    const member = await addMember(
      admin.orgId,
      admin.accessToken,
      "project-reminder-member@example.com",
    );
    const overdueDate = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Overdue project", key: "OVD", dueDate: overdueDate });
    const projectId = created.body.project._id as string;

    for (const recipient of [admin, member]) {
      const reminders = await getUnread(admin.orgId, recipient.accessToken);
      expect(reminders.body.notifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId,
            taskId: null,
            type: "project_overdue",
            message: 'Project "Overdue project" is overdue',
          }),
        ]),
      );
    }
  });
});

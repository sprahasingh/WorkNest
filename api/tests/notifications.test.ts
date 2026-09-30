import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const response = await request(app).post("/api/auth/register").send({
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
  const invitation = await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ email, role });
  const token = (invitation.body.inviteUrl as string).split("/invite/")[1];
  const signup = await request(app)
    .post(`/api/invites/${token}/signup`)
    .send({ name: email, password: "password123" });
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
  it("creates one due-soon and overdue reminder and keeps them unread until dismissed", async () => {
    const admin = await registerOrg("reminders@example.com", "Reminder Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "RM");
    await createTask(admin.orgId, projectId, admin.accessToken, {
      assigneeIds: [admin.userId],
      dueDate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    });
    await createTask(admin.orgId, projectId, admin.accessToken, {
      assigneeIds: [admin.userId],
      dueDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const firstRead = await getUnread(admin.orgId, admin.accessToken);
    expect(firstRead.body.unreadCount).toBe(2);
    expect(firstRead.body.readableUnreadCount).toBe(0);
    expect(
      firstRead.body.notifications
        .map((item: { type: string }) => item.type)
        .sort(),
    ).toEqual(["task_due_soon", "task_overdue"]);
    expect(
      firstRead.body.notifications.find(
        (item: { type: string }) => item.type === "task_due_soon",
      ).dueDate,
    ).toBeTruthy();

    const reminderId = firstRead.body.notifications[0]._id as string;
    const markedRead = await request(app)
      .patch(`/api/orgs/${admin.orgId}/notifications/read`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({});
    expect(markedRead.status).toBe(204);

    const afterMarkRead = await getUnread(admin.orgId, admin.accessToken);
    expect(afterMarkRead.body.unreadCount).toBe(2);

    const repeatedRead = await getUnread(admin.orgId, admin.accessToken);
    expect(repeatedRead.body.notifications).toHaveLength(2);

    const dismissed = await request(app)
      .patch(`/api/orgs/${admin.orgId}/notifications/dismiss`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ids: [reminderId] });
    expect(dismissed.status).toBe(204);

    const afterDismiss = await getUnread(admin.orgId, admin.accessToken);
    expect(afterDismiss.body.unreadCount).toBe(1);

    const all = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .query({ status: "all" })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(
      all.body.notifications.find(
        (item: { _id: string }) => item._id === reminderId,
      ).dismissedAt,
    ).toBeTruthy();
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
      expect(notifications.body.unreadCount).toBe(1);
      expect(notifications.body.notifications[0]).toMatchObject({
        taskId,
        type: "task_completed",
      });
    }

    const actorNotifications = await getUnread(
      admin.orgId,
      completingAssignee.accessToken,
    );
    expect(actorNotifications.body.unreadCount).toBe(0);

    await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${completingAssignee.accessToken}`)
      .send({ status: "done" });
    const afterRepeatedUpdate = await getUnread(
      admin.orgId,
      otherAssignee.accessToken,
    );
    expect(afterRepeatedUpdate.body.unreadCount).toBe(1);
  });
});

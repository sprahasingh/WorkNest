import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Task } from "../src/models/Task.js";
import { migrateLegacyTaskAssignees } from "../src/db/migrations.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const res = await registerAndVerify(app, {
    name: "Admin User",
    email,
    password: "password123",
    orgName,
  });
  const accessToken = res.body.accessToken as string;
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
    name: `User ${email}`,
    password: "password123",
  });
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return { accessToken, userId: me.body.user.id as string };
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
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

describe("task editing and visibility", () => {
  it("lets only admins, managers and assignees edit, and hides lead-assigned tasks from members", async () => {
    const admin = await registerOrg("access-admin@example.com", "Access Org");
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "alice@example.com",
    );
    const bob = await addMember(
      admin.orgId,
      admin.accessToken,
      "bob@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "ACC",
    );

    const shared = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Shared",
      assigneeIds: [alice.userId, bob.userId],
    });
    const sharedId = shared.body.task._id as string;
    expect(shared.body.task.assigneeIds).toHaveLength(2);

    for (const member of [alice, bob]) {
      const res = await request(app)
        .patch(`/api/orgs/${admin.orgId}/tasks/${sharedId}`)
        .set("Authorization", `Bearer ${member.accessToken}`)
        .send({ status: "in_progress" });
      expect(res.status).toBe(200);
    }

    const alicesOwn = await createTask(
      admin.orgId,
      projectId,
      alice.accessToken,
      {
        title: "Alice's task",
      },
    );
    expect(alicesOwn.body.task.assigneeIds).toEqual([alice.userId]);

    const bobEdits = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${alicesOwn.body.task._id}`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send({ title: "Hijacked" });
    expect(bobEdits.status).toBe(403);

    const assignOthers = await createTask(
      admin.orgId,
      projectId,
      alice.accessToken,
      {
        title: "For Bob",
        assigneeIds: [bob.userId],
      },
    );
    expect(assignOthers.status).toBe(403);

    const adminTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        title: "Admin only",
        assigneeIds: [admin.userId],
      },
    );
    const adminTaskId = adminTask.body.task._id as string;

    const list = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    const visibleIds = (list.body.items as Array<{ _id: string }>).map(
      (t) => t._id,
    );
    expect(visibleIds).toContain(sharedId);
    expect(visibleIds).not.toContain(adminTaskId);

    const direct = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${adminTaskId}`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(direct.status).toBe(404);

    const activity = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${adminTaskId}/activity`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(activity.status).toBe(404);
  });
});

describe("update requests and questions", () => {
  it("notifies named members, mentioned roles and project assignees", async () => {
    const admin = await registerOrg("mention-admin@example.com", "Mention Org");
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "mention-alice@example.com",
    );
    const bob = await addMember(
      admin.orgId,
      admin.accessToken,
      "mention-bob@example.com",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "mention-manager@example.com",
      "manager",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "MEN",
    );
    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Mentioned work",
      assigneeIds: [alice.userId],
    });

    const taskRequest = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${task.body.task._id}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        type: "update_request",
        mentionMemberIds: [bob.userId],
        mentionRoles: ["manager"],
      });
    expect(taskRequest.status).toBe(201);
    expect(taskRequest.body.notifiedCount).toBe(3);

    for (const member of [alice, bob, manager]) {
      const inbox = await request(app)
        .get(`/api/orgs/${admin.orgId}/notifications`)
        .set("Authorization", `Bearer ${member.accessToken}`);
      expect(
        inbox.body.notifications.some(
          (notification: { type: string }) =>
            notification.type === "update_request",
        ),
      ).toBe(true);
    }

    const projectUpdate = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        type: "update",
        content: "Project progress",
        mentionRoles: ["assignee"],
      });
    expect(projectUpdate.status).toBe(201);
    // Only Alice works here; the manager isn't involved, so isn't told.
    expect(projectUpdate.body.notifiedCount).toBe(1);

    const aliceInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${alice.accessToken}`);
    expect(
      aliceInbox.body.notifications.some(
        (notification: { type: string; taskId: string | null }) =>
          notification.type === "update" && notification.taskId === null,
      ),
    ).toBe(true);

    const outsider = await registerOrg(
      "mention-outsider@example.com",
      "Other Mention Org",
    );
    const invalidMention = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${task.body.task._id}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request", mentionMemberIds: [outsider.userId] });
    expect(invalidMention.status).toBe(400);
    expect(invalidMention.body.error.code).toBe("INVALID_MENTION");
  });

  it("keeps mentions to people who can see the task, and lets them reply", async () => {
    const admin = await registerOrg("scope-admin@example.com", "Scope Org");
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "scope-alice@example.com",
    );
    const bob = await addMember(
      admin.orgId,
      admin.accessToken,
      "scope-bob@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "SCO",
    );
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const post = (taskId: string, token: string, body: object) =>
      request(app)
        .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/activity`)
        .set(auth(token))
        .send(body);

    // Only admins and managers can mention a whole role.
    const shared = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Shared work",
      assigneeIds: [alice.userId],
    });
    const roleMention = await post(shared.body.task._id, alice.accessToken, {
      type: "question",
      content: "Anyone?",
      mentionRoles: ["member"],
    });
    expect(roleMention.status).toBe(403);

    // Bob isn't assigned, but once mentioned he can reply.
    const bobBefore = await post(shared.body.task._id, bob.accessToken, {
      type: "update",
      content: "Can I help?",
    });
    expect(bobBefore.status).toBe(403);
    const mentionBob = await post(shared.body.task._id, alice.accessToken, {
      type: "question",
      content: "Bob, thoughts?",
      mentionMemberIds: [bob.userId],
    });
    expect(mentionBob.status).toBe(201);
    const bobReply = await post(shared.body.task._id, bob.accessToken, {
      type: "update",
      content: "Looks good",
    });
    expect(bobReply.status).toBe(201);

    // A task assigned to the admin is hidden from members, so they can't be
    // mentioned on it, and a role mention skips them.
    const leadTask = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { title: "Lead only", assigneeIds: [admin.userId] },
    );
    const hiddenMention = await post(
      leadTask.body.task._id,
      admin.accessToken,
      {
        type: "update",
        content: "FYI",
        mentionMemberIds: [bob.userId],
      },
    );
    expect(hiddenMention.status).toBe(400);
    expect(hiddenMention.body.error.code).toBe("INVALID_MENTION");
    const roleOnHidden = await post(leadTask.body.task._id, admin.accessToken, {
      type: "update",
      content: "FYI all",
      mentionRoles: ["member"],
    });
    expect(roleOnHidden.status).toBe(201);
    const bobInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set(auth(bob.accessToken));
    expect(
      bobInbox.body.notifications.some(
        (n: { taskId: string | null }) => n.taskId === leadTask.body.task._id,
      ),
    ).toBe(false);
  });

  it("notifies task assignees on request and leads on questions", async () => {
    const admin = await registerOrg(
      "activity-admin@example.com",
      "Activity Org",
    );
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "act-alice@example.com",
    );
    const bob = await addMember(
      admin.orgId,
      admin.accessToken,
      "act-bob@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "ACT",
    );

    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Report",
      assigneeIds: [alice.userId],
    });
    const taskId = task.body.task._id as string;

    const memberRequests = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/activity`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ type: "update_request" });
    expect(memberRequests.status).toBe(403);

    const requested = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request", content: "Where are we?" });
    expect(requested.status).toBe(201);

    const aliceInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${alice.accessToken}`);
    expect(aliceInbox.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId, projectId, type: "task_assigned" }),
        expect.objectContaining({ taskId, projectId, type: "update_request" }),
      ]),
    );

    const nonAssigneeQuestion = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/activity`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send({ type: "question", content: "Can I help?" });
    expect(nonAssigneeQuestion.status).toBe(403);

    const emptyUpdate = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/activity`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ type: "update" });
    expect(emptyUpdate.status).toBe(400);

    const question = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/activity`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ type: "question", content: "Which format?" });
    expect(question.status).toBe(201);

    const adminInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(adminInbox.body.notifications).toHaveLength(1);

    const markRead = await request(app)
      .patch(`/api/orgs/${admin.orgId}/notifications/read`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ids: ["not-an-id"] });
    expect(markRead.status).toBe(400);
  });

  it("does not let a manager request an update from themselves", async () => {
    const admin = await registerOrg(
      "self-request-admin@example.com",
      "Self Request Org",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "self-request-manager@example.com",
      "manager",
    );
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "self-request-alice@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "SELF",
    );
    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Shared assignment",
      assigneeIds: [manager.userId],
    });
    const taskId = task.body.task._id as string;
    const activityPath = `/api/orgs/${admin.orgId}/tasks/${taskId}/activity`;

    const selfRequest = await request(app)
      .post(activityPath)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ type: "update_request" });
    expect(selfRequest.status).toBe(400);
    expect(selfRequest.body.error.code).toBe("SELF_UPDATE_REQUEST");
    expect(selfRequest.body.error.message).toContain(
      "can't request an update from yourself",
    );

    const projectSelfRequest = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ type: "update_request" });
    expect(projectSelfRequest.status).toBe(400);
    expect(projectSelfRequest.body.error.code).toBe("SELF_UPDATE_REQUEST");

    await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ assigneeIds: [manager.userId, alice.userId] })
      .expect(200);

    const coAssigneeRequest = await request(app)
      .post(activityPath)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ type: "update_request" });
    expect(coAssigneeRequest.status).toBe(201);
    expect(coAssigneeRequest.body.notifiedCount).toBe(1);

    const aliceInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${alice.accessToken}`);
    expect(
      aliceInbox.body.notifications.filter(
        (notification: { type: string }) =>
          notification.type === "update_request",
      ),
    ).toHaveLength(1);

    const managerInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${manager.accessToken}`);
    expect(
      managerInbox.body.notifications.some(
        (notification: { type: string }) =>
          notification.type === "update_request",
      ),
    ).toBe(false);
  });

  it("sends a project-wide update request to every open task's assignees once", async () => {
    const admin = await registerOrg(
      "project-req@example.com",
      "Project Req Org",
    );
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "pr-alice@example.com",
    );
    const bob = await addMember(
      admin.orgId,
      admin.accessToken,
      "pr-bob@example.com",
    );
    const carol = await addMember(
      admin.orgId,
      admin.accessToken,
      "pr-carol@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "PRQ",
    );

    const empty = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request" });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("NO_ASSIGNEES");

    await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "One",
      assigneeIds: [alice.userId, bob.userId],
    });
    await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Two",
      assigneeIds: [alice.userId],
    });

    const res = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request", content: "Weekly check-in" });
    expect(res.status).toBe(201);
    expect(res.body.notifiedCount).toBe(2);

    const aliceInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${alice.accessToken}`);
    const projectRequestNotifications = aliceInbox.body.notifications.filter(
      (notification: { type: string }) =>
        notification.type === "update_request",
    );
    expect(projectRequestNotifications).toHaveLength(1);
    expect(projectRequestNotifications[0].taskId).toBeNull();

    const carolPosts = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${carol.accessToken}`)
      .send({ type: "update", content: "Not on this project" });
    expect(carolPosts.status).toBe(403);

    const bobStats = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks/stats`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(bobStats.body.assignedToMe).toBe(true);

    const bobAnswers = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send({ type: "update", content: "Halfway done" });
    expect(bobAnswers.status).toBe(201);

    const feed = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${carol.accessToken}`);
    expect(feed.body.activities.map((a: { type: string }) => a.type)).toEqual([
      "update_request",
      "update",
    ]);
  });
});

describe("notification inbox and shared updates", () => {
  it("keeps co-assignees in the loop, keeps read notifications, and shares task updates in the project feed", async () => {
    const admin = await registerOrg("inbox-admin@example.com", "Inbox Org");
    const alice = await addMember(
      admin.orgId,
      admin.accessToken,
      "inbox-alice@example.com",
    );
    const bob = await addMember(
      admin.orgId,
      admin.accessToken,
      "inbox-bob@example.com",
    );
    const dave = await addMember(
      admin.orgId,
      admin.accessToken,
      "inbox-dave@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "NIB",
    );
    const base = `/api/orgs/${admin.orgId}`;

    const unassigned = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { title: "Nobody yet" },
    );
    const noAssignees = await request(app)
      .post(`${base}/tasks/${unassigned.body.task._id}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request" });
    expect(noAssignees.status).toBe(400);
    expect(noAssignees.body.error.code).toBe("NO_ASSIGNEES");

    const shared = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Shared",
      assigneeIds: [alice.userId, bob.userId],
    });
    const leadOnly = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      { title: "Lead only", assigneeIds: [admin.userId] },
    );

    await request(app)
      .post(`${base}/tasks/${shared.body.task._id}/activity`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ type: "update", content: "Draft done" })
      .expect(201);
    await request(app)
      .post(`${base}/tasks/${leadOnly.body.task._id}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update", content: "Private progress" })
      .expect(201);

    const bobUnread = await request(app)
      .get(`${base}/notifications?status=unread`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(bobUnread.body.unreadCount).toBe(2);
    const updateNotification = bobUnread.body.notifications.find(
      (notification: { type: string }) => notification.type === "update",
    );
    expect(updateNotification).toMatchObject({
      type: "update",
      actorId: alice.userId,
      taskId: shared.body.task._id,
      projectName: "Project NIB",
    });

    const aliceInbox = await request(app)
      .get(`${base}/notifications`)
      .set("Authorization", `Bearer ${alice.accessToken}`);
    expect(aliceInbox.body.notifications).toEqual([
      expect.objectContaining({
        taskId: shared.body.task._id,
        type: "task_assigned",
      }),
    ]);

    await request(app)
      .patch(`${base}/notifications/read`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send({ ids: [updateNotification._id] })
      .expect(204);

    const bobAfter = await request(app)
      .get(`${base}/notifications?status=unread`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(bobAfter.body.unreadCount).toBe(1);
    expect(bobAfter.body.notifications).toEqual([
      expect.objectContaining({ type: "task_assigned" }),
    ]);

    const bobAll = await request(app)
      .get(`${base}/notifications?status=all`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(bobAll.body.notifications).toHaveLength(2);
    expect(
      bobAll.body.notifications.find(
        (notification: { type: string }) => notification.type === "update",
      ).readAt,
    ).not.toBeNull();

    const badStatus = await request(app)
      .get(`${base}/notifications?status=everything`)
      .set("Authorization", `Bearer ${bob.accessToken}`);
    expect(badStatus.status).toBe(400);

    type FeedEntry = { content?: string; task: { title: string } | null };
    const daveFeed = await request(app)
      .get(`${base}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${dave.accessToken}`);
    const daveEntries = daveFeed.body.activities as FeedEntry[];
    expect(daveEntries.map((a) => a.content)).toEqual(["Draft done"]);
    expect(daveEntries[0]!.task?.title).toBe("Shared");

    const adminFeed = await request(app)
      .get(`${base}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(
      (adminFeed.body.activities as FeedEntry[]).map((a) => a.content),
    ).toEqual(["Draft done", "Private progress"]);
  });
});

describe("free plan active task limit", () => {
  it("reports usage and blocks the 11th active task until one is done", async () => {
    const admin = await registerOrg("limit-admin@example.com", "Limit Org");
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "LIM",
    );

    let lastId = "";
    for (let i = 0; i < 10; i++) {
      const res = await createTask(admin.orgId, projectId, admin.accessToken, {
        title: `Task ${i}`,
      });
      lastId = res.body.task._id as string;
    }

    const stats = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks/stats`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(stats.body).toEqual({
      activeCount: 10,
      activeLimit: 10,
      plan: "free",
      assignedToMe: false,
    });

    const blocked = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        title: "One too many",
      },
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("TASK_LIMIT_REACHED");

    await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${lastId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "done" });

    const allowed = await createTask(
      admin.orgId,
      projectId,
      admin.accessToken,
      {
        title: "Room again",
      },
    );
    expect(allowed.status).toBe(201);

    const reopen = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${lastId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "todo" });
    expect(reopen.status).toBe(400);
    expect(reopen.body.error.code).toBe("TASK_LIMIT_REACHED");

    const stillTen = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks/stats`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(stillTen.body.activeCount).toBe(10);

    const firstPage = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ status: "todo", limit: 4 })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(firstPage.body.items).toHaveLength(4);
    expect(firstPage.body.total).toBe(10);

    await Organization.findByIdAndUpdate(admin.orgId, { plan: "pro" });
    const reopenOnPro = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${lastId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "in_progress" });
    expect(reopenOnPro.status).toBe(200);
    const proStats = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks/stats`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(proStats.body.activeLimit).toBe(50);
  });
});

describe("legacy assignee migration", () => {
  it("moves a single assigneeId into assigneeIds", async () => {
    const admin = await registerOrg("legacy@example.com", "Legacy Org");
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "LEG",
    );
    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Old task",
    });
    const taskId = task.body.task._id as string;

    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskId) },
      {
        $set: { assigneeId: new mongoose.Types.ObjectId(admin.userId) },
        $unset: { assigneeIds: "" },
      },
    );

    await migrateLegacyTaskAssignees();

    const raw = await Task.collection.findOne({});
    expect(raw?.assigneeId).toBeUndefined();
    expect(raw?.assigneeIds.map(String)).toEqual([admin.userId]);
  });
});

describe("who hears about updates, and reply threads", () => {
  it("notifies the people involved, not every admin and manager", async () => {
    const admin = await registerOrg(
      "involved-admin@example.com",
      "Involved Org",
    );
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "involved-manager@example.com",
      "manager",
    );
    const mia = await addMember(
      admin.orgId,
      admin.accessToken,
      "involved-mia@example.com",
    );
    const leo = await addMember(
      admin.orgId,
      admin.accessToken,
      "involved-leo@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "INV",
    );
    await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Shared",
      assigneeIds: [mia.userId, leo.userId],
    });
    const base = `/api/orgs/${admin.orgId}`;
    const inbox = async (token: string) =>
      (
        await request(app)
          .get(`${base}/notifications`)
          .set("Authorization", `Bearer ${token}`)
      ).body.notifications as Array<{ type: string; message: string }>;

    const posted = await request(app)
      .post(`${base}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${mia.accessToken}`)
      .send({ type: "update", content: "Halfway there" });
    expect(posted.status).toBe(201);
    // Leo works here and the admin created the project; the manager isn't
    // involved and isn't told.
    expect(posted.body.notifiedCount).toBe(2);
    expect((await inbox(leo.accessToken)).map((n) => n.type)).toContain(
      "update",
    );
    expect((await inbox(admin.accessToken)).map((n) => n.type)).toContain(
      "update",
    );
    expect((await inbox(manager.accessToken)).map((n) => n.type)).not.toContain(
      "update",
    );

    // Mentioning the manager brings them in.
    const mentioned = await request(app)
      .post(`${base}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${mia.accessToken}`)
      .send({
        type: "question",
        content: "Can you check this?",
        mentionMemberIds: [manager.userId],
      });
    expect(mentioned.status).toBe(201);
    expect(
      (await inbox(manager.accessToken)).find((n) => n.type === "question")
        ?.message,
    ).toBe('User involved-mia@example.com mentioned you in "Project INV"');
  });

  it("lets each person reply to an update request and tells the person who asked", async () => {
    const admin = await registerOrg("thread-admin@example.com", "Thread Org");
    const mia = await addMember(
      admin.orgId,
      admin.accessToken,
      "thread-mia@example.com",
    );
    const leo = await addMember(
      admin.orgId,
      admin.accessToken,
      "thread-leo@example.com",
    );
    const outsider = await addMember(
      admin.orgId,
      admin.accessToken,
      "thread-outsider@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "THR",
    );
    await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "One",
      assigneeIds: [mia.userId, leo.userId],
    });
    const base = `/api/orgs/${admin.orgId}`;
    const post = (token: string, body: object) =>
      request(app)
        .post(`${base}/projects/${projectId}/activity`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    const asked = await post(admin.accessToken, {
      type: "update_request",
      content: "Weekly check-in",
    });
    expect(asked.status).toBe(201);
    const requestId = asked.body.activity._id as string;
    expect(asked.body.activity.askedIds.sort()).toEqual(
      [mia.userId, leo.userId].sort(),
    );

    // A reply needs the message it answers.
    const missing = await post(mia.accessToken, {
      type: "reply",
      content: "Done",
    });
    expect(missing.status).toBe(400);

    const miaReply = await post(mia.accessToken, {
      type: "reply",
      content: "Copy is finished",
      replyToId: requestId,
    });
    expect(miaReply.status).toBe(201);
    expect(miaReply.body.notifiedCount).toBe(1);
    expect(miaReply.body.notifiedNames).toEqual(["Admin User"]);
    expect(miaReply.body.activity.parentId).toBe(requestId);

    const leoReply = await post(leo.accessToken, {
      type: "reply",
      content: "Images next week",
      replyToId: requestId,
    });
    expect(leoReply.status).toBe(201);

    const adminInbox = await request(app)
      .get(`${base}/notifications`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const replies = (
      adminInbox.body.notifications as Array<{ type: string; message: string }>
    ).filter((n) => n.type === "reply");
    expect(replies.map((n) => n.message).sort()).toEqual(
      [
        'User thread-leo@example.com replied to your update request in "Project THR"',
        'User thread-mia@example.com replied to your update request in "Project THR"',
      ].sort(),
    );

    // Leo isn't told about Mia's reply to the shared request.
    const leoInbox = await request(app)
      .get(`${base}/notifications`)
      .set("Authorization", `Bearer ${leo.accessToken}`);
    expect(
      (leoInbox.body.notifications as Array<{ type: string }>).some(
        (n) => n.type === "reply",
      ),
    ).toBe(false);

    // Answering Mia's reply tells Mia, and the reply joins the same thread.
    const answer = await post(admin.accessToken, {
      type: "reply",
      content: "Thanks!",
      replyToId: miaReply.body.activity._id,
    });
    expect(answer.status).toBe(201);
    expect(answer.body.activity.parentId).toBe(requestId);
    expect(answer.body.notifiedNames).toEqual(["User thread-mia@example.com"]);

    // Someone with no part in the project can't reply.
    const outsiderReply = await post(outsider.accessToken, {
      type: "reply",
      content: "Me too",
      replyToId: requestId,
    });
    expect(outsiderReply.status).toBe(403);
  });

  it("keeps a message sent to particular people between them and the author", async () => {
    const admin = await registerOrg("direct-admin@example.com", "Direct Org");
    const manager = await addMember(
      admin.orgId,
      admin.accessToken,
      "direct-manager@example.com",
      "manager",
    );
    const mia = await addMember(
      admin.orgId,
      admin.accessToken,
      "direct-mia@example.com",
    );
    const leo = await addMember(
      admin.orgId,
      admin.accessToken,
      "direct-leo@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "DIR",
    );
    const task = await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Pair work",
      assigneeIds: [mia.userId, leo.userId],
    });
    const base = `/api/orgs/${admin.orgId}/tasks/${task.body.task._id}/activity`;
    const post = (token: string, body: object) =>
      request(app)
        .post(base)
        .set("Authorization", `Bearer ${token}`)
        .send(body);
    const inbox = async (token: string) =>
      (
        await request(app)
          .get(`/api/orgs/${admin.orgId}/notifications`)
          .set("Authorization", `Bearer ${token}`)
      ).body.notifications as Array<{ type: string; message: string }>;

    const question = await post(mia.accessToken, {
      type: "question",
      content: "Which API version?",
      mentionMemberIds: [manager.userId],
      notifyAll: false,
    });
    expect(question.status).toBe(201);
    expect(question.body.activity.notifyAll).toBe(false);
    expect(question.body.notifiedNames).toEqual([
      "User direct-manager@example.com",
    ]);
    expect((await inbox(manager.accessToken)).map((n) => n.message)).toContain(
      'User direct-mia@example.com asked you a question on "Pair work"',
    );
    // Leo works on the task and the admin created it, but it wasn't sent
    // to them, so they aren't told and can't reply.
    expect(
      (await inbox(leo.accessToken)).some((n) => n.type === "question"),
    ).toBe(false);
    for (const outsider of [leo, admin]) {
      const blocked = await post(outsider.accessToken, {
        type: "reply",
        content: "v2",
        replyToId: question.body.activity._id,
      });
      expect(blocked.status).toBe(403);
    }

    const answer = await post(manager.accessToken, {
      type: "reply",
      content: "Use v2",
      replyToId: question.body.activity._id,
    });
    expect(answer.status).toBe(201);
    expect(answer.body.notifiedNames).toEqual(["User direct-mia@example.com"]);

    // Mentioning Leo in a reply brings him into the conversation.
    const bringLeo = await post(mia.accessToken, {
      type: "reply",
      content: "Leo, see above",
      replyToId: answer.body.activity._id,
      mentionMemberIds: [leo.userId],
    });
    expect(bringLeo.status).toBe(201);
    const leoJoins = await post(leo.accessToken, {
      type: "reply",
      content: "Got it",
      replyToId: question.body.activity._id,
    });
    expect(leoJoins.status).toBe(201);
    // Everyone already in the thread hears about Leo's reply.
    expect((await inbox(manager.accessToken)).map((n) => n.message)).toContain(
      'User direct-leo@example.com replied in a question thread you\'re in on "Pair work"',
    );

    // A message sent to nobody is a quiet note: nobody is told, and
    // anyone on the task can still reply.
    const quiet = await post(mia.accessToken, {
      type: "update",
      content: "Note to self: check logs",
      notifyAll: false,
    });
    expect(quiet.status).toBe(201);
    expect(quiet.body.notifiedCount).toBe(0);
    const replyToQuiet = await post(leo.accessToken, {
      type: "reply",
      content: "Logs look fine",
      replyToId: quiet.body.activity._id,
    });
    expect(replyToQuiet.status).toBe(201);

    // An update request sent to particular people asks only them.
    const nobody = await post(admin.accessToken, {
      type: "update_request",
      notifyAll: false,
    });
    expect(nobody.status).toBe(400);
    expect(nobody.body.error.code).toBe("NO_RECIPIENTS");
    const onlyMia = await post(admin.accessToken, {
      type: "update_request",
      mentionMemberIds: [mia.userId],
      notifyAll: false,
    });
    expect(onlyMia.status).toBe(201);
    expect(onlyMia.body.activity.askedIds).toEqual([mia.userId]);
  });

  it("lets the asker mark an answer, and the requester remind people once an hour", async () => {
    const admin = await registerOrg("answer-admin@example.com", "Answer Org");
    const mia = await addMember(
      admin.orgId,
      admin.accessToken,
      "answer-mia@example.com",
    );
    const leo = await addMember(
      admin.orgId,
      admin.accessToken,
      "answer-leo@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "ANS",
    );
    await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Answers",
      assigneeIds: [mia.userId, leo.userId],
    });
    const base = `/api/orgs/${admin.orgId}/projects/${projectId}/activity`;
    const post = (token: string, body: object) =>
      request(app)
        .post(base)
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    const question = await post(mia.accessToken, {
      type: "question",
      content: "Where are the designs?",
    });
    const questionId = question.body.activity._id as string;
    const reply = await post(leo.accessToken, {
      type: "reply",
      content: "In the shared drive",
      replyToId: questionId,
    });
    const mark = (token: string, answerId: string | null) =>
      request(app)
        .patch(`${base}/${questionId}/answer`)
        .set("Authorization", `Bearer ${token}`)
        .send({ answerId });

    expect((await mark(leo.accessToken, reply.body.activity._id)).status).toBe(
      403,
    );
    expect((await mark(mia.accessToken, questionId)).status).toBe(400);
    const marked = await mark(mia.accessToken, reply.body.activity._id);
    expect(marked.status).toBe(200);
    expect(marked.body.activity.answerId).toBe(reply.body.activity._id);
    const cleared = await mark(mia.accessToken, null);
    expect(cleared.body.activity.answerId).toBeNull();

    const asked = await post(admin.accessToken, { type: "update_request" });
    const requestId = asked.body.activity._id as string;
    await post(mia.accessToken, {
      type: "reply",
      content: "Done",
      replyToId: requestId,
    });
    const remind = (token: string) =>
      request(app)
        .post(`${base}/${requestId}/remind`)
        .set("Authorization", `Bearer ${token}`);

    // Members can't send reminders.
    expect((await remind(mia.accessToken)).status).toBe(403);
    const first = await remind(admin.accessToken);
    expect(first.status).toBe(200);
    expect(first.body.notifiedNames).toEqual(["User answer-leo@example.com"]);
    const leoInbox = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications`)
      .set("Authorization", `Bearer ${leo.accessToken}`);
    expect(
      (leoInbox.body.notifications as Array<{ message: string }>).map(
        (n) => n.message,
      ),
    ).toContain('Admin User is still waiting on your update in "Project ANS"');
    const again = await remind(admin.accessToken);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("REMIND_TOO_SOON");
  });

  it("stops general chatter from a muted project but still delivers mentions", async () => {
    const admin = await registerOrg("mute-admin@example.com", "Mute Org");
    const mia = await addMember(
      admin.orgId,
      admin.accessToken,
      "mute-mia@example.com",
    );
    const leo = await addMember(
      admin.orgId,
      admin.accessToken,
      "mute-leo@example.com",
    );
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "MUT",
    );
    await createTask(admin.orgId, projectId, admin.accessToken, {
      title: "Muted",
      assigneeIds: [mia.userId, leo.userId],
    });
    const muted = await request(app)
      .put(`/api/orgs/${admin.orgId}/notifications/mutes`)
      .set("Authorization", `Bearer ${leo.accessToken}`)
      .send({ projectId, muted: true });
    expect(muted.status).toBe(200);
    const mutes = await request(app)
      .get(`/api/orgs/${admin.orgId}/notifications/mutes`)
      .set("Authorization", `Bearer ${leo.accessToken}`);
    expect(mutes.body).toEqual({ projectIds: [projectId], taskIds: [] });
    // Other people can't see who muted what.
    const members = await request(app)
      .get(`/api/orgs/${admin.orgId}/members`)
      .set("Authorization", `Bearer ${mia.accessToken}`);
    expect(JSON.stringify(members.body)).not.toContain("mutedProjectIds");

    const post = (body: object) =>
      request(app)
        .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
        .set("Authorization", `Bearer ${mia.accessToken}`)
        .send(body);
    const general = await post({ type: "update", content: "Progress" });
    expect(general.body.notifiedNames).toEqual(["Admin User"]);
    const direct = await post({
      type: "update",
      content: "Leo, look",
      mentionMemberIds: [leo.userId],
    });
    expect(direct.body.notifiedNames).toContain("User mute-leo@example.com");

    // Update requests addressed to Leo still arrive too.
    const asked = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request" });
    expect(asked.body.notifiedNames).toContain("User mute-leo@example.com");
  });

  it("shows an old thread in the project feed when someone replies to it", async () => {
    // Over a hundred requests: a fresh app so the shared rate limit isn't hit.
    const feedApp = createApp();
    const admin = await registerOrg("feed-admin@example.com", "Feed Org");
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "FED",
    );
    const base = `/api/orgs/${admin.orgId}/projects/${projectId}/activity`;
    const post = (body: object) =>
      request(feedApp)
        .post(base)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send(body);

    const first = await post({ type: "question", content: "Kick-off date?" });
    for (let i = 0; i < 100; i += 1) {
      await post({ type: "update", content: `Note ${i}`, notifyAll: false });
    }
    await post({
      type: "reply",
      content: "Monday",
      replyToId: first.body.activity._id,
    });

    const feed = await request(feedApp)
      .get(base)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const ids = (feed.body.activities as Array<{ _id: string }>).map(
      (a) => a._id,
    );
    expect(ids).toContain(first.body.activity._id);
    expect(ids[0]).toBe(first.body.activity._id);
  });
});

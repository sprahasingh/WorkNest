import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function registerOrg(email: string) {
  const signup = await registerAndVerify(app, {
    name: "Request Admin",
    email,
    password: "Harbor-lamp-91",
    orgName: "Project Request Org",
  });
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
    orgId: me.body.memberships[0].tenantId.id as string,
    userId: me.body.user.id as string,
  };
}

async function addMember(orgId: string, token: string, email: string) {
  await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${token}`)
    .send({ email, role: "member" });
  const signup = await signupInviteAndVerify(
    app,
    takeInvitationToken(email),
    email,
    { name: "Cross Project Member", password: "Harbor-lamp-91" },
  );
  const accessToken = signup.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return { accessToken, userId: me.body.user.id as string };
}

async function createProject(orgId: string, token: string, key: string) {
  const result = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${key}`, key });
  expect(result.status).toBe(201);
  return result.body.project._id as string;
}

async function createTask(
  orgId: string,
  projectId: string,
  token: string,
  title: string,
  assigneeIds: string[] = [],
) {
  const result = await request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title, assigneeIds });
  expect(result.status).toBe(201);
  return result.body.task._id as string;
}

describe("Projects-page update requests", () => {
  it("targets qualifying projects in one persisted thread with deduplicated recipients", async () => {
    const admin = await registerOrg("projects-wide-admin@example.com");
    const member = await addMember(
      admin.orgId,
      admin.accessToken,
      "projects-wide-member@example.com",
    );
    await Organization.findByIdAndUpdate(admin.orgId, {
      plan: "pro",
      projectLimit: 25,
    });
    const base = `/api/orgs/${admin.orgId}`;
    const projectOne = await createProject(
      admin.orgId,
      admin.accessToken,
      "ONE",
    );
    const projectTwo = await createProject(
      admin.orgId,
      admin.accessToken,
      "TWO",
    );
    const emptyProject = await createProject(
      admin.orgId,
      admin.accessToken,
      "EMP",
    );
    const completedProject = await createProject(
      admin.orgId,
      admin.accessToken,
      "CMP",
    );
    const archivedProject = await createProject(
      admin.orgId,
      admin.accessToken,
      "ARC",
    );
    const binnedProject = await createProject(
      admin.orgId,
      admin.accessToken,
      "BIN",
    );

    const repeatedAssignments = await createTask(
      admin.orgId,
      projectOne,
      admin.accessToken,
      "Repeated assignments",
      [member.userId, member.userId],
    );
    await createTask(
      admin.orgId,
      projectOne,
      admin.accessToken,
      "Second open task",
      [member.userId],
    );
    await createTask(
      admin.orgId,
      projectTwo,
      admin.accessToken,
      "Open in another project",
      [member.userId],
    );
    const completedTask = await createTask(
      admin.orgId,
      completedProject,
      admin.accessToken,
      "Completed task",
      [member.userId],
    );
    await request(app)
      .patch(`${base}/tasks/${completedTask}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "done" })
      .expect(200);
    await createTask(
      admin.orgId,
      archivedProject,
      admin.accessToken,
      "Archived project task",
      [member.userId],
    );
    await createTask(
      admin.orgId,
      binnedProject,
      admin.accessToken,
      "Binned project task",
      [member.userId],
    );
    await request(app)
      .post(`${base}/projects/${archivedProject}/archive`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    await request(app)
      .delete(`${base}/projects/${binnedProject}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);

    const activeList = await request(app)
      .get(`${base}/projects?view=active`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    const selectedIds = (
      activeList.body.projects as Array<{
        _id: string;
        activeTaskCount: number;
      }>
    )
      .filter((project) => project.activeTaskCount > 0)
      .map((project) => project._id);
    expect(selectedIds).toEqual(
      expect.arrayContaining([projectOne, projectTwo]),
    );
    expect(selectedIds).not.toContain(emptyProject);
    expect(selectedIds).not.toContain(completedProject);
    expect(selectedIds).not.toContain(archivedProject);
    expect(selectedIds).not.toContain(binnedProject);

    const result = await request(app)
      .post(`${base}/projects/request-across-active`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        type: "update_request",
        content: "Workspace check-in",
        notifyAll: true,
      })
      .expect(201);
    expect(result.body.notifiedCount).toBe(1);
    expect(result.body.activity.projectIds.map(String).sort()).toEqual(
      selectedIds.sort(),
    );
    expect(result.body.activity.projectNames).toHaveLength(2);
    expect(result.body.activity.sharedParticipantIds.map(String)).toContain(
      member.userId,
    );

    const memberInbox = await request(app)
      .get(`${base}/notifications?status=all`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .expect(200);
    const requestNotifications = (
      memberInbox.body.notifications as Array<{
        type: string;
        projectId: string;
        activityId: string;
        message: string;
      }>
    ).filter((notification) => notification.type === "update_request");
    expect(requestNotifications).toHaveLength(1);
    expect(requestNotifications[0]!.activityId).toBe(
      String(result.body.activity._id),
    );

    const requesterInbox = await request(app)
      .get(`${base}/notifications?status=all`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(
      (requesterInbox.body.notifications as Array<{ type: string }>).filter(
        (notification) => notification.type === "update_request",
      ),
    ).toHaveLength(0);

    for (const projectId of [projectOne, projectTwo]) {
      const feed = await request(app)
        .get(`${base}/projects/${projectId}/activity`)
        .set("Authorization", `Bearer ${member.accessToken}`)
        .expect(200);
      expect(feed.body.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "update_request",
            _id: result.body.activity._id,
            taskId: null,
            content: "Workspace check-in",
          }),
        ]),
      );
    }

    const memberUpdate = await request(app)
      .post(`${base}/projects/request-across-active`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({
        type: "update",
        content: "The shared work is progressing well.",
        notifyAll: true,
      })
      .expect(201);
    expect(memberUpdate.body.activity.projectIds.map(String).sort()).toEqual(
      selectedIds.sort(),
    );

    const question = await request(app)
      .post(`${base}/projects/request-across-active`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        type: "question",
        content: "Can you share your progress?",
        notifyAll: true,
      })
      .expect(201);
    const answer = await request(app)
      .post(`${base}/projects/${projectTwo}/activity`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({
        type: "reply",
        content: "The work is on track.",
        replyToId: question.body.activity._id,
      })
      .expect(201);
    expect(answer.body.activity.type).toBe("reply");

    const unauthorized = await request(app)
      .post(`${base}/projects/request-across-active`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ type: "update_request", content: "Should be rejected" });
    expect(unauthorized.status).toBe(403);
    expect(unauthorized.body.error.code).toBe("FORBIDDEN");

    const emptyRequest = await request(app)
      .post(`${base}/projects/${emptyProject}/activity`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request", content: "No open work" });
    expect(emptyRequest.status).toBe(400);
    expect(emptyRequest.body.error.code).toBe("NO_ASSIGNEES");

    await request(app)
      .post(`${base}/projects/${projectOne}/archive`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    await request(app)
      .post(`${base}/projects/${projectTwo}/archive`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    const noCandidates = await request(app)
      .post(`${base}/projects/request-across-active`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "update_request", content: "Nothing to ask" });
    expect(noCandidates.status).toBe(400);
    expect(noCandidates.body.error.code).toBe("NO_PROJECTS");

    // Repeated task and cross-project assignments collapse to one person and
    // one notification for this workspace request.
    expect(repeatedAssignments).toBeTruthy();
  });
});

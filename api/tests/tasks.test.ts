import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Task } from "../src/models/Task.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();
app.set("trust proxy", 1);
let registrationIp = 0;

async function registerOrg(email: string, orgName: string) {
  registrationIp += 1;
  const res = await registerAndVerify(
    app,
    { name: "Test User", email, password: "password123", orgName },
    `198.51.100.${registrationIp}`,
  );

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

describe("cross-tenant task reference checks", () => {
  it("rejects creating a task against another org's projectId", async () => {
    const orgA = await registerOrg("task-a@example.com", "Task Org A");
    const orgB = await registerOrg("task-b@example.com", "Task Org B");
    const projectIdA = await createProject(orgA.orgId, orgA.accessToken, "AA");

    const res = await request(app)
      .post(`/api/orgs/${orgB.orgId}/projects/${projectIdA}/tasks`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ title: "Malicious task" });

    expect(res.status).toBe(404);
  });

  it("rejects assigning a task to a user from another org", async () => {
    const orgA = await registerOrg("task-c@example.com", "Task Org C");
    const orgB = await registerOrg("task-d@example.com", "Task Org D");
    const projectIdA = await createProject(orgA.orgId, orgA.accessToken, "CC");

    const res = await request(app)
      .post(`/api/orgs/${orgA.orgId}/projects/${projectIdA}/tasks`)
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ title: "Bad assignment", assigneeIds: [orgB.userId] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ASSIGNEE");
  });
});

describe("task ownership rules", () => {
  it("lets a member edit their own task but not someone else's, and blocks reassignment", async () => {
    const admin = await registerOrg("owner-admin@example.com", "Owner Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "OW");

    await request(app)
      .post(`/api/orgs/${admin.orgId}/invites`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: "member-owner@example.com", role: "member" });

    const token = takeInvitationToken("member-owner@example.com");

    const signupRes = await signupInviteAndVerify(
      app,
      token,
      "member-owner@example.com",
      { name: "Regular Member", password: "password123" },
    );

    const memberToken = signupRes.body.accessToken as string;

    const memberMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${memberToken}`);
    const memberId = memberMe.body.user.id as string;

    const ownTaskRes = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "My own task" });

    const ownTaskId = ownTaskRes.body.task._id as string;

    const editOwnRes = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${ownTaskId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Updated by owner" });

    expect(editOwnRes.status).toBe(200);

    const othersTaskRes = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Admin's task" });

    const othersTaskId = othersTaskRes.body.task._id as string;

    const editOthersRes = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${othersTaskId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Hijacked" });

    expect(editOthersRes.status).toBe(403);

    const reassignRes = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${ownTaskId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ assigneeIds: [memberId] });

    expect(reassignRes.status).toBe(403);
  });
});

describe("completed task lifecycle", () => {
  it("timestamps completion, blocks edits, and clears the timestamp on reopen", async () => {
    const admin = await registerOrg(
      "completed-task@example.com",
      "Completed Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "CT");
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Lifecycle task" });
    const taskId = created.body.task._id as string;

    const completed = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "done" });
    expect(completed.status).toBe(200);
    expect(completed.body.task.completedAt).toBeTruthy();

    const editedWhileDone = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Changed while done" });
    expect(editedWhileDone.status).toBe(409);
    expect(editedWhileDone.body.error.code).toBe("TASK_COMPLETED_READ_ONLY");

    const repeatedDone = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "done" });
    expect(repeatedDone.status).toBe(200);

    const reopened = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "in_progress" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.task.completedAt).toBeNull();

    const editedAfterReopen = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Changed after reopen" });
    expect(editedAfterReopen.status).toBe(200);
    expect(editedAfterReopen.body.task.title).toBe("Changed after reopen");
  });
});

describe("task archive and bin lifecycle", () => {
  it("archives completed tasks without deleting their history and allows unarchive", async () => {
    const admin = await registerOrg("archived-task@example.com", "Archive Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "AR");
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Archive lifecycle" });
    const taskId = created.body.task._id as string;

    await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "done" });

    const archived = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}/archive`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(archived.status).toBe(200);
    expect(archived.body.task.archivedAt).toBeTruthy();

    const completedView = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "completed" })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(completedView.body.items).toHaveLength(0);

    const archivedView = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "archived" })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(archivedView.body.items).toHaveLength(1);

    const details = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(details.status).toBe(200);

    const edit = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Should be blocked" });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe("TASK_ARCHIVED_READ_ONLY");

    const unarchived = await request(app)
      .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}/unarchive`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(unarchived.status).toBe(200);
    expect(unarchived.body.task.archivedAt).toBeNull();
  });

  it("moves tasks to the bin, restores them, and only permanently deletes from bin", async () => {
    const admin = await registerOrg("binned-task@example.com", "Bin Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "BN");
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Bin lifecycle" });
    const taskId = created.body.task._id as string;

    const permanentActive = await request(app)
      .delete(`/api/orgs/${admin.orgId}/tasks/${taskId}/permanent`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(permanentActive.status).toBe(404);

    const binned = await request(app)
      .delete(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(binned.status).toBe(204);

    const binView = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "bin" })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(binView.body.items).toHaveLength(1);
    expect(binView.body.items[0].purgeAt).toBeTruthy();
    expect(binView.body.binRetentionDays).toBe(30);

    const hiddenDetails = await request(app)
      .get(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(hiddenDetails.status).toBe(404);

    const restored = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/restore`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(restored.status).toBe(200);
    expect(restored.body.task.deletedAt).toBeNull();

    const activeView = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "active" })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(activeView.body.items).toHaveLength(1);

    await request(app)
      .delete(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const permanentlyDeleted = await request(app)
      .delete(`/api/orgs/${admin.orgId}/tasks/${taskId}/permanent`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(permanentlyDeleted.status).toBe(204);
  });

  it("requires restoring a binned project before restoring one of its tasks", async () => {
    const admin = await registerOrg("nested-bin@example.com", "Nested Bin Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "NB");
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Nested restore" });
    const taskId = created.body.task._id as string;

    await request(app)
      .delete(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    await request(app)
      .delete(`/api/orgs/${admin.orgId}/projects/${projectId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    const blockedRestore = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/restore`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(blockedRestore.status).toBe(409);
    expect(blockedRestore.body.error.code).toBe("PROJECT_IN_BIN");

    const restoredProject = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/restore`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(restoredProject.status).toBe(200);

    const restoredTask = await request(app)
      .post(`/api/orgs/${admin.orgId}/tasks/${taskId}/restore`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(restoredTask.status).toBe(200);
  });

  it("purges expired tasks when the Bin view is opened", async () => {
    const admin = await registerOrg("expired-task@example.com", "Expired Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "EX");
    const created = await request(app)
      .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ title: "Expired task" });
    const taskId = created.body.task._id as string;

    await request(app)
      .delete(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskId) },
      {
        $set: {
          deletedAt: new Date(Date.now() - 31 * 86_400_000),
        },
      },
    );

    const binView = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "bin" })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(binView.status).toBe(200);
    expect(binView.body.items).toHaveLength(0);
    expect(
      await Task.collection.findOne({
        _id: new mongoose.Types.ObjectId(taskId),
      }),
    ).toBeNull();
  });

  it("sorts completed view by completion time and paginates with a stable cursor", async () => {
    const admin = await registerOrg(
      "completed-pages@example.com",
      "Completed Pages Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "CP");
    const taskIds: string[] = [];
    for (const title of ["Older", "Newer"]) {
      const created = await request(app)
        .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ title });
      const taskId = created.body.task._id as string;
      taskIds.push(taskId);
      await request(app)
        .patch(`/api/orgs/${admin.orgId}/tasks/${taskId}`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ status: "done" });
    }

    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds[0]) },
      { $set: { completedAt: new Date("2025-01-01T00:00:00.000Z") } },
    );
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds[1]) },
      { $set: { completedAt: new Date("2025-02-01T00:00:00.000Z") } },
    );

    const firstPage = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "completed", limit: 1 })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(firstPage.body.items[0].title).toBe("Newer");
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "completed", limit: 1, cursor: firstPage.body.nextCursor })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(secondPage.body.items[0].title).toBe("Older");
    expect(secondPage.body.nextCursor).toBeNull();

    const oldestFirst = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ view: "completed", sortOrder: "asc", limit: 1 })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(oldestFirst.body.items[0].title).toBe("Older");

    const nextOldestPage = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({
        view: "completed",
        sortOrder: "asc",
        limit: 1,
        cursor: oldestFirst.body.nextCursor,
      })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(nextOldestPage.body.items[0].title).toBe("Newer");
    expect(nextOldestPage.body.nextCursor).toBeNull();
  });
});

describe("task pagination", () => {
  it("sorts active tasks by due date by default and paginates null dates", async () => {
    const admin = await registerOrg(
      "due-date-pages@example.com",
      "Due Date Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "DD");
    const taskIds: Record<string, string> = {};

    for (const title of ["Soon", "Later", "Undated"]) {
      const created = await request(app)
        .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ title });
      taskIds[title] = created.body.task._id as string;
    }

    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds.Soon) },
      { $set: { dueDate: new Date("2025-02-01T00:00:00.000Z") } },
    );
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds.Later) },
      { $set: { dueDate: new Date("2025-03-01T00:00:00.000Z") } },
    );
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds.Soon) },
      { $set: { createdAt: new Date("2025-01-01T00:00:00.000Z") } },
    );
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds.Later) },
      { $set: { createdAt: new Date("2025-02-01T00:00:00.000Z") } },
    );
    await Task.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(taskIds.Undated) },
      { $set: { createdAt: new Date("2025-03-01T00:00:00.000Z") } },
    );

    const listTitles = async (sortOrder?: "asc" | "desc") => {
      const titles: string[] = [];
      const seenIds = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: request.Response = await request(app)
          .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
          .query({ limit: 1, sortOrder, cursor: cursor ?? undefined })
          .set("Authorization", `Bearer ${admin.accessToken}`);
        expect(page.status).toBe(200);
        expect(
          page.body.items,
          `cursor: ${cursor ?? "first page"}`,
        ).toHaveLength(1);
        expect(seenIds.has(page.body.items[0]._id)).toBe(false);
        seenIds.add(page.body.items[0]._id);
        titles.push(page.body.items[0].title);
        cursor = page.body.nextCursor;
      } while (cursor);
      return titles;
    };

    expect(await listTitles()).toEqual(["Undated", "Later", "Soon"]);
    expect(await listTitles("asc")).toEqual(["Soon", "Later", "Undated"]);

    const createdDateSort = await request(app)
      .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
      .query({ sortBy: "createdAt", limit: 1 })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(createdDateSort.body.items[0].title).toBe("Undated");
  });

  it("uses priority to break equal date ties across pages", async () => {
    const admin = await registerOrg(
      "priority-sort@example.com",
      "Priority Sort Org",
    );
    const projectId = await createProject(admin.orgId, admin.accessToken, "PS");
    const auth = { Authorization: `Bearer ${admin.accessToken}` };
    const createdTasks = await Promise.all(
      (["low", "medium", "high"] as const).map((priority) =>
        request(app)
          .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
          .set(auth)
          .send({ title: priority, priority, dueDate: "2025-02-01" }),
      ),
    );
    const sameDate = new Date("2025-02-01T00:00:00.000Z");
    await Task.collection.updateMany(
      { projectId: new mongoose.Types.ObjectId(projectId) },
      { $set: { createdAt: sameDate, dueDate: sameDate } },
    );

    const getTitles = async (sortBy?: "createdAt") => {
      const titles: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await request(app)
          .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
          .query({ sortBy, limit: 1, cursor: cursor ?? undefined })
          .set(auth);
        expect(page.status).toBe(200);
        titles.push(page.body.items[0].title);
        cursor = page.body.nextCursor;
      } while (cursor);
      return titles;
    };

    expect(createdTasks.every((task) => task.status === 201)).toBe(true);
    expect(await getTitles()).toEqual(["high", "medium", "low"]);
    expect(await getTitles("createdAt")).toEqual(["high", "medium", "low"]);
  });

  it("returns every item exactly once across pages, even with concurrent inserts", async () => {
    const admin = await registerOrg("page-admin@example.com", "Page Org");
    const projectId = await createProject(admin.orgId, admin.accessToken, "PG");

    await Organization.findByIdAndUpdate(admin.orgId, { plan: "pro" });

    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        request(app)
          .post(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
          .set("Authorization", `Bearer ${admin.accessToken}`)
          .send({ title: `Task ${i}` }),
      ),
    );

    const seen = new Set<string>();
    let cursor: string | null = null;

    do {
      const query: Record<string, string | number> = { limit: 4 };
      if (cursor) {
        query.cursor = cursor;
      }

      const res = await request(app)
        .get(`/api/orgs/${admin.orgId}/projects/${projectId}/tasks`)
        .query(query)
        .set("Authorization", `Bearer ${admin.accessToken}`);

      for (const item of res.body.items) {
        seen.add(item._id);
      }

      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen.size).toBe(15);
  });
});

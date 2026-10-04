import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Notification } from "../src/models/Notification.js";
import { inDays, inMinutes, setupOrg } from "./orgHelpers.js";

const app = createApp();

const meetings = (orgId: string, token: string) => ({
  get: (path = "") =>
    request(app)
      .get(`/api/orgs/${orgId}/meetings${path}`)
      .set("Authorization", `Bearer ${token}`),
  post: (path = "", body: object = {}) =>
    request(app)
      .post(`/api/orgs/${orgId}/meetings${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  patch: (path: string, body: object) =>
    request(app)
      .patch(`/api/orgs/${orgId}/meetings${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body: object) =>
    request(app)
      .put(`/api/orgs/${orgId}/meetings${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  del: (path: string) =>
    request(app)
      .delete(`/api/orgs/${orgId}/meetings${path}`)
      .set("Authorization", `Bearer ${token}`),
});

const weekly = (count: number, extra: object = {}) => {
  const starts = Array.from({ length: count }, (_, i) => inDays(2 + i * 7));
  return {
    title: "Weekly sync",
    startsAt: starts[0],
    endsAt: new Date(new Date(starts[0]).getTime() + 30 * 60_000).toISOString(),
    repeat: { freq: "weekly", starts },
    ...extra,
  };
};

describe("repeating meetings", () => {
  it("create one row per date and count as one invitation", async () => {
    const { orgId, addMember } = await setupOrg(app, "repeat.test");
    const sam = await addMember("sam");
    const priya = await addMember("priya");

    const created = await meetings(orgId, sam.token).post(
      "",
      weekly(4, { attendeeIds: [priya.id] }),
    );
    expect(created.status).toBe(201);
    expect(created.body.meeting.series).toMatchObject({
      index: 1,
      count: 4,
      frequency: "weekly",
    });

    const list = await meetings(orgId, priya.token).get("?view=upcoming");
    expect(list.body.meetings).toHaveLength(4);
    const summary = await meetings(orgId, priya.token).get("/summary");
    expect(summary.body.pendingInvites).toBe(1);
    // One notification for the whole series, not one per date.
    expect(
      await Notification.countDocuments({
        userId: priya.id,
        type: "meeting_invited",
      }).setOptions({ skipTenant: true }),
    ).toBe(1);
  });

  it("reject repeat dates that don't match or run too long", async () => {
    const { orgId, addMember } = await setupOrg(app, "repeat-bad.test");
    const sam = await addMember("sam");
    const bad = weekly(3);
    await meetings(orgId, sam.token)
      .post("", {
        ...bad,
        startsAt: inDays(5),
        endsAt: new Date(
          new Date(inDays(5)).getTime() + 1800_000,
        ).toISOString(),
      })
      .expect(400);
    await meetings(orgId, sam.token)
      .post("", {
        ...bad,
        repeat: { freq: "daily", starts: [inDays(3), inDays(2)] },
        startsAt: inDays(3),
        endsAt: new Date(
          new Date(inDays(3)).getTime() + 1800_000,
        ).toISOString(),
      })
      .expect(400);
    await meetings(orgId, sam.token)
      .post("", weekly(2, { repeat: { freq: "yearly", starts: [] } }))
      .expect(400);
  });

  it("apply replies, edits and cancels to this date or all later ones", async () => {
    const { orgId, addMember } = await setupOrg(app, "repeat-scope.test");
    const sam = await addMember("sam");
    const priya = await addMember("priya");
    const created = await meetings(orgId, sam.token).post(
      "",
      weekly(4, { attendeeIds: [priya.id] }),
    );
    const firstId = created.body.meeting.id as string;
    const all = (await meetings(orgId, sam.token).get("?view=upcoming")).body
      .meetings as { id: string; startsAt: string }[];
    const second = all[1];

    // Replying to one date leaves the others alone.
    await meetings(orgId, priya.token)
      .put(`/${firstId}/response`, { response: "accepted" })
      .expect(200);
    let mine = (await meetings(orgId, priya.token).get("?view=upcoming")).body
      .meetings as { myResponse: string }[];
    expect(mine.map((m) => m.myResponse)).toEqual([
      "accepted",
      "pending",
      "pending",
      "pending",
    ]);
    // "Going to all" covers this date and the rest.
    await meetings(orgId, priya.token)
      .put(`/${second.id}/response`, { response: "declined", scope: "all" })
      .expect(200);
    mine = (await meetings(orgId, priya.token).get("?view=upcoming")).body
      .meetings;
    expect(mine.map((m) => m.myResponse)).toEqual([
      "accepted",
      "declined",
      "declined",
      "declined",
    ]);

    // Renaming and moving "all upcoming" shifts every later date by the same
    // amount; notes stay with the one date they were written on.
    const newStart = new Date(new Date(second.startsAt).getTime() + 3600_000);
    const edited = await meetings(orgId, sam.token).patch(`/${second.id}`, {
      title: "Weekly sync (new)",
      startsAt: newStart.toISOString(),
      endsAt: new Date(newStart.getTime() + 45 * 60_000).toISOString(),
      notes: "only here",
      scope: "all",
    });
    expect(edited.status).toBe(200);
    const after = (await meetings(orgId, sam.token).get("?view=upcoming")).body
      .meetings as {
      title: string;
      startsAt: string;
      endsAt: string;
      notes: string;
    }[];
    expect(after[0].title).toBe("Weekly sync");
    expect(after.slice(1).map((m) => m.title)).toEqual([
      "Weekly sync (new)",
      "Weekly sync (new)",
      "Weekly sync (new)",
    ]);
    for (const [index, meeting] of after.slice(1).entries()) {
      expect(new Date(meeting.startsAt).getTime()).toBe(
        new Date(all[index + 1].startsAt).getTime() + 3600_000,
      );
      expect(
        new Date(meeting.endsAt).getTime() -
          new Date(meeting.startsAt).getTime(),
      ).toBe(45 * 60_000);
    }
    expect(after.map((m) => m.notes)).toEqual(["", "only here", "", ""]);
    // The new time asks for a fresh reply.
    mine = (await meetings(orgId, priya.token).get("?view=upcoming")).body
      .meetings;
    expect(mine[0].myResponse).toBe("accepted");
    expect(mine[1].myResponse).toBe("pending");

    // Cancelling one date, then all later ones.
    await meetings(orgId, sam.token)
      .post(`/${second.id}/cancel`, { scope: "this" })
      .expect(200);
    expect(
      (await meetings(orgId, sam.token).get("?view=upcoming")).body.meetings,
    ).toHaveLength(3);
    const thirdId = (
      (await meetings(orgId, sam.token).get("?view=upcoming")).body
        .meetings as {
        id: string;
      }[]
    )[1].id;
    await meetings(orgId, sam.token)
      .post(`/${thirdId}/cancel`, { scope: "all" })
      .expect(200);
    expect(
      (await meetings(orgId, sam.token).get("?view=upcoming")).body.meetings,
    ).toHaveLength(1);
  });
});

describe("proposing a new time", () => {
  it("lets an invitee suggest one and the organizer accept or keep the original", async () => {
    const { orgId, addMember } = await setupOrg(app, "propose.test");
    const sam = await addMember("sam");
    const priya = await addMember("priya");
    const lee = await addMember("lee");
    const created = await meetings(orgId, sam.token).post("", {
      title: "Review",
      startsAt: inMinutes(120),
      endsAt: inMinutes(150),
      attendeeIds: [priya.id, lee.id],
    });
    const id = created.body.meeting.id as string;
    await meetings(orgId, lee.token).put(`/${id}/response`, {
      response: "accepted",
    });

    await meetings(orgId, sam.token)
      .post(`/${id}/proposals`, {
        startsAt: inMinutes(300),
        endsAt: inMinutes(330),
      })
      .expect(400);

    const proposed = await meetings(orgId, priya.token).post(
      `/${id}/proposals`,
      { startsAt: inMinutes(300), endsAt: inMinutes(330), note: "Clash at 2" },
    );
    expect(proposed.status).toBe(200);
    expect(proposed.body.meeting.proposals).toHaveLength(1);
    await meetings(orgId, lee.token).post(`/${id}/proposals`, {
      startsAt: inMinutes(400),
      endsAt: inMinutes(430),
    });

    // The organizer sees every suggestion, each invitee only their own.
    const forSam = await meetings(orgId, sam.token).get(`/${id}`);
    expect(forSam.body.meeting.proposals).toHaveLength(2);
    const forPriya = await meetings(orgId, priya.token).get(`/${id}`);
    expect(forPriya.body.meeting.proposals).toHaveLength(1);
    expect(
      await Notification.countDocuments({
        userId: sam.id,
        type: "meeting_proposal",
      }).setOptions({ skipTenant: true }),
    ).toBe(2);

    await meetings(orgId, priya.token)
      .post(`/${id}/proposals/${priya.id}/accept`)
      .expect(403);
    await meetings(orgId, sam.token)
      .del(`/${id}/proposals/${lee.id}`)
      .expect(200);

    const accepted = await meetings(orgId, sam.token).post(
      `/${id}/proposals/${priya.id}/accept`,
    );
    expect(accepted.status).toBe(200);
    expect(new Date(accepted.body.meeting.startsAt).getTime()).toBeGreaterThan(
      Date.now() + 250 * 60_000,
    );
    // Moving the meeting clears suggestions and asks everyone to reply again.
    expect(accepted.body.meeting.proposals).toHaveLength(0);
    const leeView = await meetings(orgId, lee.token).get(`/${id}`);
    expect(leeView.body.meeting.myResponse).toBe("pending");
    expect(
      await Notification.countDocuments({
        userId: lee.id,
        type: "meeting_response",
        message: /kept the original/,
      }).setOptions({ skipTenant: true }),
    ).toBe(1);
  });

  it("lets the person who proposed take it back", async () => {
    const { orgId, addMember } = await setupOrg(app, "withdraw.test");
    const sam = await addMember("sam");
    const priya = await addMember("priya");
    const created = await meetings(orgId, sam.token).post("", {
      title: "Chat",
      startsAt: inMinutes(120),
      endsAt: inMinutes(150),
      attendeeIds: [priya.id],
    });
    const id = created.body.meeting.id as string;
    await meetings(orgId, priya.token).post(`/${id}/proposals`, {
      startsAt: inMinutes(300),
      endsAt: inMinutes(330),
    });
    const gone = await meetings(orgId, priya.token).del(
      `/${id}/proposals/${priya.id}`,
    );
    expect(gone.body.meeting.proposals).toHaveLength(0);
  });
});

describe("linking meetings to work", () => {
  async function withTask() {
    const ctx = await setupOrg(app, "links.test");
    const sam = await ctx.addMember("sam");
    const priya = await ctx.addMember("priya");
    const project = await request(app)
      .post(`/api/orgs/${ctx.orgId}/projects`)
      .set("Authorization", `Bearer ${ctx.admin.token}`)
      .send({ name: "Launch", key: "LAU" });
    const projectId = project.body.project._id as string;
    // A task assigned to the admin: members can't see it.
    const hidden = await request(app)
      .post(`/api/orgs/${ctx.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${ctx.admin.token}`)
      .send({ title: "Admin only task", assigneeIds: [ctx.admin.id] });
    const open = await request(app)
      .post(`/api/orgs/${ctx.orgId}/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${ctx.admin.token}`)
      .send({ title: "Open task" });
    return {
      ...ctx,
      sam,
      priya,
      projectId,
      hiddenTaskId: hidden.body.task._id as string,
      openTaskId: open.body.task._id as string,
    };
  }

  it("attach a task or project, but only one you can open", async () => {
    const ctx = await withTask();
    const base = {
      title: "Task sync",
      startsAt: inMinutes(120),
      endsAt: inMinutes(150),
    };

    await meetings(ctx.orgId, ctx.sam.token)
      .post("", { ...base, taskId: ctx.hiddenTaskId })
      .expect(404);

    const linked = await meetings(ctx.orgId, ctx.sam.token).post("", {
      ...base,
      attendeeIds: [ctx.priya.id, ctx.admin.id],
      taskId: ctx.openTaskId,
    });
    expect(linked.status).toBe(201);
    expect(linked.body.meeting.link).toMatchObject({
      projectId: ctx.projectId,
      projectName: "Launch",
      taskId: ctx.openTaskId,
      taskTitle: "Open task",
    });

    const byTask = await meetings(ctx.orgId, ctx.priya.token).get(
      `?view=upcoming&taskId=${ctx.openTaskId}`,
    );
    expect(byTask.body.meetings).toHaveLength(1);
    const byProject = await meetings(ctx.orgId, ctx.sam.token).get(
      `?view=upcoming&projectId=${ctx.projectId}`,
    );
    expect(byProject.body.meetings).toHaveLength(1);
    const unrelated = await meetings(ctx.orgId, ctx.sam.token).get(
      `?view=upcoming&taskId=${ctx.hiddenTaskId}`,
    );
    expect(unrelated.body.meetings).toHaveLength(0);

    // Linking to a project alone, then clearing the link.
    const id = linked.body.meeting.id as string;
    const projectOnly = await meetings(ctx.orgId, ctx.sam.token).patch(
      `/${id}`,
      { projectId: ctx.projectId, taskId: null },
    );
    expect(projectOnly.body.meeting.link).toMatchObject({
      taskId: null,
      projectName: "Launch",
    });
    const cleared = await meetings(ctx.orgId, ctx.sam.token).patch(`/${id}`, {
      projectId: null,
      taskId: null,
    });
    expect(cleared.body.meeting.link).toBeNull();
  });

  it("don't name a task to an invitee who can't see it", async () => {
    const ctx = await withTask();
    // The admin organizes a meeting about their own task and invites a member.
    const created = await meetings(ctx.orgId, ctx.admin.token).post("", {
      title: "Private task chat",
      startsAt: inMinutes(120),
      endsAt: inMinutes(150),
      attendeeIds: [ctx.sam.id],
      taskId: ctx.hiddenTaskId,
    });
    expect(created.status).toBe(201);
    const forAdmin = await meetings(ctx.orgId, ctx.admin.token).get(
      `/${created.body.meeting.id}`,
    );
    expect(forAdmin.body.meeting.link.taskTitle).toBe("Admin only task");
    const forSam = await meetings(ctx.orgId, ctx.sam.token).get(
      `/${created.body.meeting.id}`,
    );
    expect(forSam.body.meeting.link.taskTitle).toBeNull();
  });
});

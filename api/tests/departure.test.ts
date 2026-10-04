import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Notification } from "../src/models/Notification.js";
import { inMinutes, setupOrg } from "./orgHelpers.js";

const app = createApp();

async function world() {
  const ctx = await setupOrg(app, "leave.test");
  const sam = await ctx.addMember("sam");
  const priya = await ctx.addMember("priya");
  const lee = await ctx.addMember("lee");
  return { ...ctx, sam, priya, lee };
}

const api = (orgId: string, token: string) => ({
  get: (path: string) =>
    request(app)
      .get(`/api/orgs/${orgId}${path}`)
      .set("Authorization", `Bearer ${token}`),
  post: (path: string, body: object = {}) =>
    request(app)
      .post(`/api/orgs/${orgId}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  del: (path: string, body?: object) =>
    request(app)
      .delete(`/api/orgs/${orgId}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
});

const meetingBody = (attendeeIds: string[], extra: object = {}) => ({
  title: "Planning",
  startsAt: inMinutes(120),
  endsAt: inMinutes(150),
  attendeeIds,
  ...extra,
});

describe("when someone leaves the organization", () => {
  it("takes them out of groups and keeps one-to-one chats", async () => {
    const { orgId, admin, sam, priya, lee } = await world();
    const group = await api(orgId, sam.token).post("/chat/conversations", {
      type: "group",
      name: "Crew",
      memberIds: [priya.id, lee.id],
    });
    const groupId = group.body.conversation.id as string;
    const dm = await api(orgId, priya.token).post("/chat/conversations", {
      type: "direct",
      userId: sam.id,
    });

    await api(orgId, admin.token)
      .del(`/members/${sam.membershipId}`)
      .expect(204);

    const after = await api(orgId, priya.token).get(
      `/chat/conversations/${groupId}`,
    );
    const ids = after.body.conversation.members.map(
      (m: { userId: string }) => m.userId,
    );
    expect(ids.sort()).toEqual([priya.id, lee.id].sort());
    // Sam was the group's only admin, so someone inherits the role.
    expect(after.body.conversation.adminIds).toHaveLength(1);
    expect(ids).toContain(after.body.conversation.adminIds[0]);
    const messages = await api(orgId, priya.token).get(
      `/chat/conversations/${groupId}/messages`,
    );
    expect(
      messages.body.messages.some((m: { text: string }) =>
        /sam left the organization/i.test(m.text),
      ),
    ).toBe(true);

    // The direct chat is still there, but nobody can send into it now.
    const direct = await api(orgId, priya.token).get(
      `/chat/conversations/${dm.body.conversation.id}`,
    );
    expect(direct.status).toBe(200);
    const send = await api(orgId, priya.token).post(
      `/chat/conversations/${dm.body.conversation.id}/messages`,
      { text: "still there?" },
    );
    expect(send.status).toBe(409);
  });

  it("cancels the meetings they organize unless told otherwise", async () => {
    const { orgId, admin, sam, priya } = await world();
    const mine = await api(orgId, sam.token).post(
      "/meetings",
      meetingBody([priya.id], { title: "Sam's meeting" }),
    );
    const theirs = await api(orgId, priya.token).post(
      "/meetings",
      meetingBody([sam.id, admin.id], { title: "Priya's meeting" }),
    );

    await api(orgId, admin.token)
      .del(`/members/${sam.membershipId}`)
      .expect(204);

    const cancelled = await api(orgId, priya.token).get(
      `/meetings/${mine.body.meeting.id}`,
    );
    expect(cancelled.body.meeting.cancelledAt).not.toBeNull();
    expect(
      await Notification.countDocuments({
        userId: priya.id,
        type: "meeting_cancelled",
      }).setOptions({ skipTenant: true }),
    ).toBe(1);

    // Invited to someone else's meeting: just dropped from the list.
    const other = await api(orgId, priya.token).get(
      `/meetings/${theirs.body.meeting.id}`,
    );
    expect(other.body.meeting.cancelledAt).toBeNull();
    expect(
      other.body.meeting.attendees.map((a: { userId: string }) => a.userId),
    ).not.toContain(sam.id);
  });

  it("hands their meetings to someone when asked", async () => {
    const { orgId, admin, sam, priya, lee } = await world();
    const created = await api(orgId, sam.token).post(
      "/meetings",
      meetingBody([priya.id]),
    );
    const id = created.body.meeting.id as string;

    // Handing over to someone who isn't in the organization changes nothing.
    await api(orgId, admin.token)
      .del(`/members/${sam.membershipId}`, {
        meetings: { action: "handover", userId: "64b000000000000000000000" },
      })
      .expect(400);
    await api(orgId, sam.token).get(`/meetings/${id}`).expect(200);

    await api(orgId, admin.token)
      .del(`/members/${sam.membershipId}`, {
        meetings: { action: "handover", userId: lee.id },
      })
      .expect(204);

    const moved = await api(orgId, lee.token).get(`/meetings/${id}`);
    expect(moved.status).toBe(200);
    expect(moved.body.meeting.isOrganizer).toBe(true);
    expect(moved.body.meeting.cancelledAt).toBeNull();
    expect(
      moved.body.meeting.attendees.map((a: { userId: string }) => a.userId),
    ).not.toContain(sam.id);
    expect(
      await Notification.countDocuments({
        userId: lee.id,
        message: /handed you/,
      }).setOptions({ skipTenant: true }),
    ).toBe(1);
  });

  it("lets someone who leaves on their own choose too", async () => {
    const { orgId, sam, priya } = await world();
    const created = await api(orgId, sam.token).post(
      "/meetings",
      meetingBody([priya.id]),
    );
    await api(orgId, sam.token)
      .del(`/members/${sam.membershipId}`, {
        meetings: { action: "handover", userId: priya.id },
      })
      .expect(204);
    const view = await api(orgId, priya.token).get(
      `/meetings/${created.body.meeting.id}`,
    );
    expect(view.body.meeting.isOrganizer).toBe(true);
  });

  it("tells admins how many meetings, and the owner which ones", async () => {
    const { orgId, admin, sam, priya } = await world();
    await api(orgId, sam.token).post(
      "/meetings",
      meetingBody([priya.id], { title: "Secret sync" }),
    );

    const forAdmin = await api(orgId, admin.token).get(
      `/members/${sam.membershipId}/meeting-impact`,
    );
    expect(forAdmin.body.organizedUpcoming).toBe(1);
    expect(forAdmin.body.meetings).toBeUndefined();

    const forSelf = await api(orgId, sam.token).get(
      `/members/${sam.membershipId}/meeting-impact`,
    );
    expect(
      forSelf.body.meetings.map((m: { title: string }) => m.title),
    ).toEqual(["Secret sync"]);

    await api(orgId, priya.token)
      .get(`/members/${sam.membershipId}/meeting-impact`)
      .expect(403);
  });
});

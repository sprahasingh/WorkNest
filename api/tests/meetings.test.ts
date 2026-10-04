import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Notification } from "../src/models/Notification.js";
import { sendMeetingReminders } from "../src/modules/meetings/meetings.service.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function setup() {
  const response = await registerAndVerify(app, {
    name: "Admin User",
    email: "admin@meet.test",
    password: "Harbor-lamp-91",
    orgName: "Meet Org",
  });
  const adminToken = response.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${adminToken}`);
  const orgId = me.body.memberships[0].tenantId.id as string;

  async function addMember(email: string) {
    await request(app)
      .post(`/api/orgs/${orgId}/invites`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, role: "member" });
    const signup = await signupInviteAndVerify(
      app,
      takeInvitationToken(email),
      email,
      { name: email, password: "Harbor-lamp-91" },
    );
    const token = signup.body.accessToken as string;
    const profile = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    return { token, id: profile.body.user.id as string };
  }

  return {
    orgId,
    admin: { token: adminToken, id: me.body.user.id as string },
    addMember,
  };
}

const api = (orgId: string, token: string) => ({
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
});

const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60 * 1000).toISOString();

function meetingBody(attendeeIds: string[], extra: object = {}) {
  return {
    title: "Sprint planning",
    agenda: "Scope the next sprint",
    startsAt: inMinutes(120),
    endsAt: inMinutes(180),
    joinUrl: "https://meet.jit.si/worknest-test",
    attendeeIds,
    ...extra,
  };
}

describe("meetings", () => {
  it("are visible only to the organizer and invitees", async () => {
    const { orgId, admin, addMember } = await setup();
    const sam = await addMember("sam@meet.test");
    const priya = await addMember("priya@meet.test");

    // A member organizes; the org admin isn't invited.
    const created = await api(orgId, sam.token).post(
      "",
      meetingBody([priya.id]),
    );
    expect(created.status).toBe(201);
    const id = created.body.meeting.id as string;
    expect(created.body.meeting.attendees).toHaveLength(2);
    expect(created.body.meeting.isOrganizer).toBe(true);

    await api(orgId, priya.token).get(`/${id}`).expect(200);
    await api(orgId, admin.token).get(`/${id}`).expect(404);
    const adminList = await api(orgId, admin.token).get("?view=upcoming");
    expect(adminList.body.meetings).toHaveLength(0);
    const priyaList = await api(orgId, priya.token).get("?view=upcoming");
    expect(priyaList.body.meetings).toHaveLength(1);
  });

  it("notify invitees and track RSVPs", async () => {
    const { orgId, addMember } = await setup();
    const sam = await addMember("sam@meet.test");
    const priya = await addMember("priya@meet.test");
    const created = await api(orgId, sam.token).post(
      "",
      meetingBody([priya.id]),
    );
    const id = created.body.meeting.id as string;

    const invite = await Notification.findOne({
      userId: priya.id,
      type: "meeting_invited",
    }).lean();
    expect(invite?.meetingId?.toString()).toBe(id);

    const summary = await api(orgId, priya.token).get("/summary");
    expect(summary.body.pendingInvites).toBe(1);
    expect(summary.body.next.id).toBe(id);

    const accepted = await api(orgId, priya.token).put(`/${id}/response`, {
      response: "accepted",
    });
    expect(accepted.body.meeting.myResponse).toBe("accepted");
    expect(
      (await api(orgId, priya.token).get("/summary")).body.pendingInvites,
    ).toBe(0);
    expect(
      await Notification.countDocuments({
        userId: sam.id,
        type: "meeting_response",
      }),
    ).toBe(1);

    // The organizer doesn't RSVP to their own meeting.
    await api(orgId, sam.token)
      .put(`/${id}/response`, { response: "declined" })
      .expect(400);
  });

  it("let only the organizer edit, and reset RSVPs when the time moves", async () => {
    const { orgId, addMember } = await setup();
    const sam = await addMember("sam@meet.test");
    const priya = await addMember("priya@meet.test");
    const created = await api(orgId, sam.token).post(
      "",
      meetingBody([priya.id]),
    );
    const id = created.body.meeting.id as string;
    await api(orgId, priya.token).put(`/${id}/response`, {
      response: "accepted",
    });

    await api(orgId, priya.token)
      .patch(`/${id}`, { title: "Hijacked" })
      .expect(403);

    const moved = await api(orgId, sam.token).patch(`/${id}`, {
      startsAt: inMinutes(240),
      endsAt: inMinutes(270),
    });
    expect(moved.status).toBe(200);
    const priyaRow = moved.body.meeting.attendees.find(
      (a: { userId: string }) => a.userId === priya.id,
    );
    expect(priyaRow.response).toBe("pending");
    expect(
      await Notification.countDocuments({
        userId: priya.id,
        type: "meeting_updated",
      }),
    ).toBe(1);
  });

  it("can add and remove people, and be cancelled", async () => {
    const { orgId, addMember } = await setup();
    const sam = await addMember("sam@meet.test");
    const priya = await addMember("priya@meet.test");
    const lee = await addMember("lee@meet.test");
    const created = await api(orgId, sam.token).post(
      "",
      meetingBody([priya.id]),
    );
    const id = created.body.meeting.id as string;

    await api(orgId, sam.token)
      .patch(`/${id}`, { attendeeIds: [lee.id] })
      .expect(200);
    await api(orgId, lee.token).get(`/${id}`).expect(200);
    await api(orgId, priya.token).get(`/${id}`).expect(404);

    await api(orgId, lee.token).post(`/${id}/cancel`).expect(403);
    const cancelled = await api(orgId, sam.token).post(`/${id}/cancel`);
    expect(cancelled.body.meeting.cancelledAt).not.toBeNull();
    expect(
      await Notification.countDocuments({
        userId: lee.id,
        type: "meeting_cancelled",
      }),
    ).toBe(1);

    const upcoming = await api(orgId, lee.token).get("?view=upcoming");
    expect(upcoming.body.meetings).toHaveLength(0);
    const past = await api(orgId, lee.token).get("?view=past");
    expect(past.body.meetings).toHaveLength(1);
    await api(orgId, sam.token)
      .patch(`/${id}`, { title: "Revived" })
      .expect(409);
  });

  it("check the times and who can be invited", async () => {
    const { orgId, admin, addMember } = await setup();
    const sam = await addMember("sam@meet.test");

    await api(orgId, sam.token)
      .post(
        "",
        meetingBody([], { startsAt: inMinutes(60), endsAt: inMinutes(30) }),
      )
      .expect(400);
    await api(orgId, sam.token)
      .post(
        "",
        meetingBody([], { startsAt: inMinutes(-120), endsAt: inMinutes(-60) }),
      )
      .expect(400);
    await api(orgId, sam.token)
      .post("", meetingBody([], { joinUrl: "javascript:alert(1)" }))
      .expect(400);
    await api(orgId, sam.token)
      .post("", meetingBody(["64b000000000000000000000"]))
      .expect(400);
    await api(orgId, sam.token)
      .post("", meetingBody([admin.id], { joinUrl: "" }))
      .expect(201);
  });

  it("send one reminder shortly before a meeting starts", async () => {
    const { orgId, addMember } = await setup();
    const sam = await addMember("sam@meet.test");
    const priya = await addMember("priya@meet.test");
    const created = await api(orgId, sam.token).post(
      "",
      meetingBody([priya.id], {
        startsAt: inMinutes(10),
        endsAt: inMinutes(40),
      }),
    );
    expect(created.status).toBe(201);

    await sendMeetingReminders();
    await sendMeetingReminders();
    expect(
      await Notification.countDocuments({
        type: "meeting_starting",
        userId: { $in: [sam.id, priya.id] },
      }),
    ).toBe(2);
  });

  it("lets the organizer extend a meeting that has already started", async () => {
    const { orgId, addMember } = await setup();
    const sam = await addMember("sam@meet.test");
    const created = await api(orgId, sam.token).post(
      "",
      meetingBody([], { startsAt: inMinutes(-2), endsAt: inMinutes(28) }),
    );
    expect(created.status).toBe(201);
    const id = created.body.meeting.id as string;

    await api(orgId, sam.token)
      .patch(`/${id}`, { endsAt: inMinutes(58) })
      .expect(200);
    await api(orgId, sam.token)
      .patch(`/${id}`, { startsAt: inMinutes(-60), endsAt: inMinutes(58) })
      .expect(400);
  });
});

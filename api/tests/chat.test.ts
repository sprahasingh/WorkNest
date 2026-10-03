import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Message } from "../src/models/Message.js";
import {
  registerAndVerify,
  signupInviteAndVerify,
  takeInvitationToken,
} from "./emailDeliveryMock.js";

const app = createApp();

async function setup() {
  const response = await registerAndVerify(app, {
    name: "Admin User",
    email: "admin@chat.test",
    password: "password123",
    orgName: "Chat Org",
  });
  const adminToken = response.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${adminToken}`);
  const orgId = me.body.memberships[0].tenantId.id as string;

  async function addMember(
    email: string,
    role: "member" | "manager" = "member",
  ) {
    await request(app)
      .post(`/api/orgs/${orgId}/invites`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email, role });
    const signup = await signupInviteAndVerify(
      app,
      takeInvitationToken(email),
      email,
      { name: email, password: "password123" },
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
  get: (path: string) =>
    request(app)
      .get(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`),
  post: (path: string, body: object = {}) =>
    request(app)
      .post(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  patch: (path: string, body: object) =>
    request(app)
      .patch(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  del: (path: string) =>
    request(app)
      .delete(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`),
});

describe("direct messages", () => {
  it("are private to the two people, even from org admins", async () => {
    const { orgId, admin, addMember } = await setup();
    const sam = await addMember("sam@chat.test");
    const priya = await addMember("priya@chat.test");

    const created = await api(orgId, sam.token).post("/conversations", {
      type: "direct",
      userId: priya.id,
    });
    expect(created.status).toBe(201);
    const conversationId = created.body.conversation.id as string;

    await api(orgId, sam.token)
      .post(`/conversations/${conversationId}/messages`, { text: "secret" })
      .expect(201);

    // The admin can't see the thread, its messages, or send into it.
    const adminList = await api(orgId, admin.token).get("/conversations");
    expect(adminList.body.conversations).toHaveLength(0);
    await api(orgId, admin.token)
      .get(`/conversations/${conversationId}/messages`)
      .expect(404);
    await api(orgId, admin.token)
      .post(`/conversations/${conversationId}/messages`, { text: "hi" })
      .expect(404);

    const priyaView = await api(orgId, priya.token).get(
      `/conversations/${conversationId}/messages`,
    );
    expect(
      priyaView.body.messages.map((m: { text: string }) => m.text),
    ).toEqual(["secret"]);
  });

  it("reuse one thread per pair and refuse yourself or outsiders", async () => {
    const { orgId, admin, addMember } = await setup();
    const sam = await addMember("sam@chat.test");

    const first = await api(orgId, admin.token).post("/conversations", {
      type: "direct",
      userId: sam.id,
    });
    const again = await api(orgId, sam.token).post("/conversations", {
      type: "direct",
      userId: admin.id,
    });
    expect(again.status).toBe(200);
    expect(again.body.conversation.id).toBe(first.body.conversation.id);

    await api(orgId, admin.token)
      .post("/conversations", { type: "direct", userId: admin.id })
      .expect(400);
    await api(orgId, admin.token)
      .post("/conversations", {
        type: "direct",
        userId: "64b000000000000000000000",
      })
      .expect(400);
  });

  it("track unread counts and clear them when read", async () => {
    const { orgId, admin, addMember } = await setup();
    const sam = await addMember("sam@chat.test");
    const created = await api(orgId, admin.token).post("/conversations", {
      type: "direct",
      userId: sam.id,
    });
    const id = created.body.conversation.id as string;

    await api(orgId, admin.token).post(`/conversations/${id}/messages`, {
      text: "one",
    });
    await api(orgId, admin.token).post(`/conversations/${id}/messages`, {
      text: "two",
    });

    const before = await api(orgId, sam.token).get("/conversations");
    expect(before.body.unreadCount).toBe(2);
    expect(before.body.conversations[0].unreadCount).toBe(2);
    const own = await api(orgId, admin.token).get("/conversations");
    expect(own.body.unreadCount).toBe(0);

    await api(orgId, sam.token).post(`/conversations/${id}/read`).expect(204);
    const after = await api(orgId, sam.token).get("/conversations");
    expect(after.body.unreadCount).toBe(0);
  });
});

describe("messages", () => {
  async function thread() {
    const ctx = await setup();
    const sam = await ctx.addMember("sam@chat.test");
    const created = await api(ctx.orgId, ctx.admin.token).post(
      "/conversations",
      {
        type: "direct",
        userId: sam.id,
      },
    );
    return { ...ctx, sam, id: created.body.conversation.id as string };
  }

  it("can be edited by the sender within 10 minutes only", async () => {
    const { orgId, admin, sam, id } = await thread();
    const sent = await api(orgId, admin.token).post(
      `/conversations/${id}/messages`,
      {
        text: "helo",
      },
    );
    const messageId = sent.body.message.id as string;

    const edited = await api(orgId, admin.token).patch(
      `/messages/${messageId}`,
      {
        text: "hello",
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.message.text).toBe("hello");
    expect(edited.body.message.editedAt).not.toBeNull();

    await api(orgId, sam.token)
      .patch(`/messages/${messageId}`, { text: "nope" })
      .expect(403);

    await Message.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(messageId) },
      { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } },
    );
    const late = await api(orgId, admin.token).patch(`/messages/${messageId}`, {
      text: "too late",
    });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe("EDIT_WINDOW_EXPIRED");
  });

  it("can be deleted by the sender at any time, leaving a tombstone", async () => {
    const { orgId, admin, sam, id } = await thread();
    const sent = await api(orgId, admin.token).post(
      `/conversations/${id}/messages`,
      {
        text: "oops",
      },
    );
    const messageId = sent.body.message.id as string;

    await api(orgId, sam.token).del(`/messages/${messageId}`).expect(403);
    await Message.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(messageId) },
      { $set: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } },
    );
    const removed = await api(orgId, admin.token).del(`/messages/${messageId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.message.deletedAt).not.toBeNull();
    expect(removed.body.message.text).toBe("");

    const list = await api(orgId, sam.token).get(
      `/conversations/${id}/messages`,
    );
    expect(list.body.messages[0].deletedAt).not.toBeNull();
    expect(list.body.messages[0].text).toBe("");
  });

  it("support replies and toggled reactions", async () => {
    const { orgId, admin, sam, id } = await thread();
    const first = await api(orgId, admin.token).post(
      `/conversations/${id}/messages`,
      {
        text: "question?",
      },
    );
    const reply = await api(orgId, sam.token).post(
      `/conversations/${id}/messages`,
      {
        text: "answer",
        replyToId: first.body.message.id,
      },
    );
    expect(reply.body.message.replyTo).toMatchObject({
      id: first.body.message.id,
      text: "question?",
    });

    const messageId = first.body.message.id as string;
    const on = await api(orgId, sam.token).post(
      `/messages/${messageId}/reactions`,
      {
        emoji: "👍",
      },
    );
    expect(on.body.message.reactions).toEqual([
      { emoji: "👍", userIds: [sam.id] },
    ]);
    const off = await api(orgId, sam.token).post(
      `/messages/${messageId}/reactions`,
      {
        emoji: "👍",
      },
    );
    expect(off.body.message.reactions).toEqual([]);
    await api(orgId, sam.token)
      .post(`/messages/${messageId}/reactions`, { emoji: "🦄" })
      .expect(400);
  });

  it("need some text or an attachment, and page backwards", async () => {
    const { orgId, admin, id } = await thread();
    await api(orgId, admin.token)
      .post(`/conversations/${id}/messages`, { text: "   " })
      .expect(400);
    await api(orgId, admin.token)
      .post(`/conversations/${id}/messages`, {
        text: "x",
        attachments: [
          {
            url: "https://res.cloudinary.com/x/y.png",
            publicId: "x",
            resourceType: "image",
            name: "y.png",
          },
        ],
      })
      .expect(503);

    for (let i = 1; i <= 5; i += 1) {
      await api(orgId, admin.token).post(`/conversations/${id}/messages`, {
        text: `m${i}`,
      });
    }
    const page1 = await api(orgId, admin.token).get(
      `/conversations/${id}/messages?limit=3`,
    );
    expect(page1.body.messages.map((m: { text: string }) => m.text)).toEqual([
      "m3",
      "m4",
      "m5",
    ]);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await api(orgId, admin.token).get(
      `/conversations/${id}/messages?limit=3&before=${page1.body.nextCursor}`,
    );
    expect(page2.body.messages.map((m: { text: string }) => m.text)).toEqual(
      ["m2", "m1"].reverse(),
    );
    expect(page2.body.hasMore).toBe(false);
  });
});

describe("group chats", () => {
  it("only show to their members and let admins manage them", async () => {
    const { orgId, admin, addMember } = await setup();
    const sam = await addMember("sam@chat.test");
    const priya = await addMember("priya@chat.test");
    const lee = await addMember("lee@chat.test");

    const created = await api(orgId, sam.token).post("/conversations", {
      type: "group",
      name: "Launch crew",
      memberIds: [priya.id],
    });
    expect(created.status).toBe(201);
    const id = created.body.conversation.id as string;
    expect(created.body.conversation.members).toHaveLength(2);

    // Not in the group: invisible, even to the org admin.
    await api(orgId, admin.token).get(`/conversations/${id}`).expect(404);
    await api(orgId, lee.token).get(`/conversations/${id}`).expect(404);

    // Only the group admin can add people or rename.
    await api(orgId, priya.token)
      .post(`/conversations/${id}/members`, { userIds: [lee.id] })
      .expect(403);
    await api(orgId, priya.token)
      .patch(`/conversations/${id}`, { name: "Hijacked" })
      .expect(403);
    const added = await api(orgId, sam.token).post(
      `/conversations/${id}/members`,
      {
        userIds: [lee.id],
      },
    );
    expect(added.body.conversation.members).toHaveLength(3);
    await api(orgId, lee.token).get(`/conversations/${id}`).expect(200);

    const renamed = await api(orgId, sam.token).patch(`/conversations/${id}`, {
      name: "Launch team",
    });
    expect(renamed.body.conversation.name).toBe("Launch team");

    await api(orgId, lee.token)
      .post(`/conversations/${id}/messages`, { text: "hi all" })
      .expect(201);
    const seen = await api(orgId, priya.token).get(
      `/conversations/${id}/messages`,
    );
    const texts = seen.body.messages.map((m: { text: string }) => m.text);
    expect(texts).toContain("hi all");

    // System lines for group events never count as unread.
    const list = await api(orgId, priya.token).get("/conversations");
    expect(list.body.conversations[0].unreadCount).toBe(1);
  });

  it("let members leave, be removed, and keep an admin", async () => {
    const { orgId, addMember } = await setup();
    const sam = await addMember("sam@chat.test");
    const priya = await addMember("priya@chat.test");
    const lee = await addMember("lee@chat.test");
    const created = await api(orgId, sam.token).post("/conversations", {
      type: "group",
      name: "Trio",
      memberIds: [priya.id, lee.id],
    });
    const id = created.body.conversation.id as string;

    await api(orgId, priya.token)
      .del(`/conversations/${id}/members/${lee.id}`)
      .expect(403);
    await api(orgId, sam.token)
      .del(`/conversations/${id}/members/${lee.id}`)
      .expect(200);
    await api(orgId, lee.token).get(`/conversations/${id}`).expect(404);

    // The only admin leaving hands the role to someone who's left.
    await api(orgId, sam.token)
      .del(`/conversations/${id}/members/${sam.id}`)
      .expect(200);
    const after = await api(orgId, priya.token).get(`/conversations/${id}`);
    expect(after.body.conversation.adminIds).toEqual([priya.id]);

    await api(orgId, priya.token)
      .del(`/conversations/${id}/members/${priya.id}`)
      .expect(200);
    await api(orgId, priya.token).get(`/conversations/${id}`).expect(404);
  });

  it("can't include people from another organization", async () => {
    const { orgId, admin } = await setup();
    const other = await registerAndVerify(app, {
      name: "Outsider",
      email: "out@other.test",
      password: "password123",
      orgName: "Other Org",
    });
    const outsider = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${other.body.accessToken}`);

    await api(orgId, admin.token)
      .post("/conversations", {
        type: "group",
        name: "Leaky",
        memberIds: [outsider.body.user.id],
      })
      .expect(400);
    await request(app)
      .get(`/api/orgs/${orgId}/chat/conversations`)
      .set("Authorization", `Bearer ${other.body.accessToken}`)
      .expect(404);
  });
});

describe("chat settings", () => {
  it("report attachments as off until storage is configured", async () => {
    const { orgId, admin } = await setup();
    const config = await api(orgId, admin.token).get("/config");
    expect(config.body).toEqual({ attachments: false });
    await api(orgId, admin.token).post("/attachments/sign").expect(503);
  });
});

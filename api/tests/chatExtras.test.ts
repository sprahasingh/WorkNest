import { describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Message } from "../src/models/Message.js";
import { Conversation } from "../src/models/Conversation.js";
import { Organization } from "../src/models/Organization.js";
import { purgeExpiredChatMessages } from "../src/modules/chat/chatRetention.service.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();

const chat = (orgId: string, token: string) => ({
  get: (path: string) =>
    request(app)
      .get(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`),
  post: (path: string, body: object = {}) =>
    request(app)
      .post(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body: object) =>
    request(app)
      .put(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
});

async function group() {
  const ctx = await setupOrg(app, "extras.test");
  const sam = await ctx.addMember("sam");
  const priya = await ctx.addMember("priya");
  const created = await chat(ctx.orgId, sam.token).post("/conversations", {
    type: "group",
    name: "Crew",
    memberIds: [priya.id, ctx.admin.id],
  });
  return { ...ctx, sam, priya, id: created.body.conversation.id as string };
}

describe("muting and mentions", () => {
  it("count a mention even in a muted chat, and nothing else", async () => {
    const { orgId, sam, priya, id } = await group();
    await chat(orgId, priya.token)
      .put(`/conversations/${id}/mute`, { muted: true })
      .expect(200);

    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "just chatting",
    });
    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "more chatting",
    });
    let list = await chat(orgId, priya.token).get("/conversations");
    expect(list.body.conversations[0].muted).toBe(true);
    expect(list.body.conversations[0].unreadCount).toBe(2);
    expect(list.body.conversations[0].mentionCount).toBe(0);
    // Muted and no mention: the sidebar badge stays quiet.
    expect(list.body.unreadCount).toBe(0);

    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "@priya can you look?",
      mentionIds: [priya.id],
    });
    list = await chat(orgId, priya.token).get("/conversations");
    expect(list.body.conversations[0].mentionCount).toBe(1);
    expect(list.body.unreadCount).toBe(1);

    // Everyone else still sees the plain unread count.
    const other = await chat(orgId, sam.token).get("/conversations");
    expect(other.body.conversations[0].muted).toBe(false);

    await chat(orgId, priya.token)
      .put(`/conversations/${id}/mute`, { muted: false })
      .expect(200);
    list = await chat(orgId, priya.token).get("/conversations");
    expect(list.body.unreadCount).toBe(3);
  });

  it("only keep mentions of people in the conversation", async () => {
    const { orgId, admin, sam, priya } = await group();
    const lee = await (
      await setupOrg(app, "other-extras.test")
    ).addMember("lee");
    const dm = await chat(orgId, sam.token).post("/conversations", {
      type: "direct",
      userId: priya.id,
    });
    const sent = await chat(orgId, sam.token).post(
      `/conversations/${dm.body.conversation.id}/messages`,
      {
        text: "hello @someone",
        mentionIds: [admin.id, lee.id, sam.id, priya.id],
      },
    );
    expect(sent.status).toBe(201);
    // Not in the chat (the admin, someone from another org) or yourself.
    expect(sent.body.message.mentions).toEqual([priya.id]);
  });

  it("can't be muted by someone who isn't in the chat", async () => {
    const { orgId, admin, id } = await group();
    const other = await chat(orgId, admin.token).put(
      `/conversations/${id}/mute`,
      { muted: true },
    );
    expect(other.status).toBe(200); // the admin was added to this group
    const { admin: outsider } = await setupOrg(app, "elsewhere.test");
    await request(app)
      .put(`/api/orgs/${orgId}/chat/conversations/${id}/mute`)
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ muted: true })
      .expect(404);
  });
});

describe("message search", () => {
  it("finds text in your own conversations only, newest first", async () => {
    const { orgId, admin, sam, priya, addMember } = await group();
    const lee = await addMember("lee");

    await chat(orgId, sam.token).post(
      `/conversations/${(await chat(orgId, sam.token).get("/conversations")).body.conversations[0].id}/messages`,
      { text: "Launch checklist v1" },
    );
    const dm = await chat(orgId, sam.token).post("/conversations", {
      type: "direct",
      userId: priya.id,
    });
    await chat(orgId, sam.token).post(
      `/conversations/${dm.body.conversation.id}/messages`,
      { text: "the LAUNCH is friday (50% done)" },
    );
    // Lee has a private chat with the admin that mentions launch too.
    const private1 = await chat(orgId, lee.token).post("/conversations", {
      type: "direct",
      userId: admin.id,
    });
    await chat(orgId, lee.token).post(
      `/conversations/${private1.body.conversation.id}/messages`,
      { text: "secret launch plan" },
    );

    const found = await chat(orgId, sam.token).get("/search?q=launch");
    expect(found.status).toBe(200);
    expect(found.body.results.map((r: { text: string }) => r.text)).toEqual([
      "the LAUNCH is friday (50% done)",
      "Launch checklist v1",
    ]);

    // Special characters are searched for literally.
    const literal = await chat(orgId, sam.token).get("/search?q=50%25%20done");
    expect(literal.body.results).toHaveLength(1);
    const regexy = await chat(orgId, sam.token).get("/search?q=.*");
    expect(regexy.body.results).toHaveLength(0);

    await chat(orgId, sam.token).get("/search?q=a").expect(400);
  });
});

describe("chat retention", () => {
  it("is set by admins only, from a fixed list", async () => {
    const { orgId, admin, addMember } = await setupOrg(app, "retain.test");
    const sam = await addMember("sam");
    const patch = (token: string, body: object) =>
      request(app)
        .patch(`/api/orgs/${orgId}`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    await patch(sam.token, { chatRetentionDays: 90 }).expect(403);
    await patch(admin.token, { chatRetentionDays: 30, currentPassword: "Harbor-lamp-91" }).expect(400);
    await patch(admin.token, { chatRetentionDays: 90, currentPassword: "wrong-password" }).expect(401);
    await patch(admin.token, { chatRetentionDays: 90 }).expect(400);
    const ok = await patch(admin.token, { chatRetentionDays: 180, currentPassword: "Harbor-lamp-91" });
    expect(ok.status).toBe(200);
    expect(ok.body.organization.chatRetentionDays).toBe(180);
    const cleared = await patch(admin.token, { chatRetentionDays: null, currentPassword: "Harbor-lamp-91" });
    expect(cleared.body.organization.chatRetentionDays).toBeNull();
  });

  it("deletes old messages for opted-in organizations and fixes the preview", async () => {
    const ctx = await setupOrg(app, "purge.test");
    const sam = await ctx.addMember("sam");
    const dm = await chat(ctx.orgId, ctx.admin.token).post("/conversations", {
      type: "direct",
      userId: sam.id,
    });
    const id = dm.body.conversation.id as string;
    const old = await chat(ctx.orgId, ctx.admin.token).post(
      `/conversations/${id}/messages`,
      { text: "ancient" },
    );
    await chat(ctx.orgId, ctx.admin.token).post(
      `/conversations/${id}/messages`,
      { text: "recent" },
    );
    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    await Message.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(old.body.message.id) },
      { $set: { createdAt: longAgo } },
    );

    // No setting: nothing is touched.
    expect(await purgeExpiredChatMessages()).toBe(0);

    await Organization.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(ctx.orgId) },
      { $set: { chatRetentionDays: 90 } },
    );
    expect(await purgeExpiredChatMessages()).toBe(1);

    const left = await chat(ctx.orgId, sam.token).get(
      `/conversations/${id}/messages`,
    );
    expect(left.body.messages.map((m: { text: string }) => m.text)).toEqual([
      "recent",
    ]);

    // Purging the newest message too leaves a clean preview.
    await Message.collection.updateMany({}, { $set: { createdAt: longAgo } });
    await purgeExpiredChatMessages();
    const conversation = await Conversation.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    expect(conversation?.lastMessage).toBeNull();
  });
});

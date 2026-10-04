import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Message } from "../src/models/Message.js";
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
  del: (path: string) =>
    request(app)
      .delete(`/api/orgs/${orgId}/chat${path}`)
      .set("Authorization", `Bearer ${token}`),
});

async function setup() {
  const ctx = await setupOrg(app, "msgdel.test");
  const sam = await ctx.addMember("sam");
  const lee = await ctx.addMember("lee");
  const dm = await chat(ctx.orgId, ctx.admin.token).post("/conversations", {
    type: "direct",
    userId: sam.id,
  });
  const say = async (who: { token: string }, id: string, text: string) =>
    (
      await chat(ctx.orgId, who.token).post(`/conversations/${id}/messages`, {
        text,
      })
    ).body.message.id as string;
  return { ...ctx, sam, lee, id: dm.body.conversation.id as string, say };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
const backdate = (messageId: string, minutes: number) =>
  Message.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(messageId) },
    { $set: { createdAt: ago(minutes) } },
  );

describe("deleting a message for everyone", () => {
  it("works for the sender for 30 minutes and then stops", async () => {
    const { orgId, admin, id, say } = await setup();
    const recent = await say(admin, id, "sent a while ago");
    await backdate(recent, 29);
    await chat(orgId, admin.token).del(`/messages/${recent}`).expect(200);

    const old = await say(admin, id, "sent much earlier");
    await backdate(old, 31);
    const late = await chat(orgId, admin.token).del(`/messages/${old}`);
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe("DELETE_WINDOW_EXPIRED");

    // The message is untouched.
    const list = await chat(orgId, admin.token).get(
      `/conversations/${id}/messages`,
    );
    const row = list.body.messages.find((m: { id: string }) => m.id === old);
    expect(row.deletedAt).toBeNull();
    expect(row.text).toBe("sent much earlier");
  });

  it("is only for the sender", async () => {
    const { orgId, sam, id, say, admin } = await setup();
    const mine = await say(admin, id, "mine");
    await chat(orgId, sam.token).del(`/messages/${mine}`).expect(403);
  });
});

describe("deleting a message for yourself", () => {
  it("hides it from you only, on any message, at any age", async () => {
    const { orgId, admin, sam, id, say } = await setup();
    const fromSam = await say(sam, id, "hello from sam");
    const fromMe = await say(admin, id, "my own reply");
    await backdate(fromMe, 24 * 60);

    // You can hide someone else's message, and your own old one.
    await chat(orgId, admin.token)
      .post(`/messages/${fromSam}/hide`)
      .expect(200);
    await chat(orgId, admin.token).post(`/messages/${fromMe}/hide`).expect(200);

    const mine = await chat(orgId, admin.token).get(
      `/conversations/${id}/messages`,
    );
    expect(mine.body.messages).toHaveLength(0);

    // The other person still sees both, untouched.
    const theirs = await chat(orgId, sam.token).get(
      `/conversations/${id}/messages`,
    );
    expect(theirs.body.messages.map((m: { text: string }) => m.text)).toEqual([
      "hello from sam",
      "my own reply",
    ]);
    expect(
      theirs.body.messages.every(
        (m: { deletedAt: unknown }) => m.deletedAt === null,
      ),
    ).toBe(true);
  });

  it("drops it from search, the unread count and the chat preview", async () => {
    const { orgId, admin, sam, id, say } = await setup();
    await say(sam, id, "first note");
    const newest = await say(sam, id, "secret plan");

    let list = await chat(orgId, admin.token).get("/conversations");
    expect(list.body.conversations[0].unreadCount).toBe(2);
    expect(list.body.conversations[0].lastMessage.text).toBe("secret plan");

    await chat(orgId, admin.token).post(`/messages/${newest}/hide`).expect(200);

    list = await chat(orgId, admin.token).get("/conversations");
    expect(list.body.conversations[0].unreadCount).toBe(1);
    expect(list.body.conversations[0].lastMessage.text).toBe("first note");
    const found = await chat(orgId, admin.token).get("/search?q=secret");
    expect(found.body.results).toHaveLength(0);

    // Sam's preview is unchanged.
    const sams = await chat(orgId, sam.token).get("/conversations");
    expect(sams.body.conversations[0].lastMessage.text).toBe("secret plan");
  });

  it("shows a reply to a hidden message as deleted, only to you", async () => {
    const { orgId, admin, sam, id, say } = await setup();
    const original = await say(sam, id, "the question");
    const reply = (
      await chat(orgId, admin.token).post(`/conversations/${id}/messages`, {
        text: "the answer",
        replyToId: original,
      })
    ).body.message.id as string;
    await chat(orgId, admin.token)
      .post(`/messages/${original}/hide`)
      .expect(200);

    const mine = await chat(orgId, admin.token).get(
      `/conversations/${id}/messages`,
    );
    const row = mine.body.messages.find((m: { id: string }) => m.id === reply);
    expect(row.replyTo.deleted).toBe(true);
    expect(row.replyTo.text).toBe("");

    const theirs = await chat(orgId, sam.token).get(
      `/conversations/${id}/messages`,
    );
    const theirRow = theirs.body.messages.find(
      (m: { id: string }) => m.id === reply,
    );
    expect(theirRow.replyTo.deleted).toBe(false);
    expect(theirRow.replyTo.text).toBe("the question");
  });

  it("can't be used by someone outside the conversation", async () => {
    const { orgId, admin, lee, id, say } = await setup();
    const message = await say(admin, id, "private");
    await chat(orgId, lee.token).post(`/messages/${message}/hide`).expect(404);
  });
});

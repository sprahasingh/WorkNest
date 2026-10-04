import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
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

async function pair() {
  const ctx = await setupOrg(app, "clear.test");
  const sam = await ctx.addMember("sam");
  const dm = await chat(ctx.orgId, ctx.admin.token).post("/conversations", {
    type: "direct",
    userId: sam.id,
  });
  return { ...ctx, sam, id: dm.body.conversation.id as string };
}

describe("deleting a conversation for yourself", () => {
  it("hides it and its history from you only", async () => {
    const { orgId, admin, sam, id } = await pair();
    await chat(orgId, admin.token).post(`/conversations/${id}/messages`, {
      text: "before the clear",
    });
    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "reply before the clear",
    });

    await chat(orgId, admin.token).del(`/conversations/${id}`).expect(204);

    const mine = await chat(orgId, admin.token).get("/conversations");
    expect(mine.body.conversations).toHaveLength(0);
    expect(mine.body.unreadCount).toBe(0);
    const history = await chat(orgId, admin.token).get(
      `/conversations/${id}/messages`,
    );
    expect(history.body.messages).toHaveLength(0);
    const found = await chat(orgId, admin.token).get("/search?q=clear");
    expect(found.body.results).toHaveLength(0);

    // The other person keeps everything.
    const theirs = await chat(orgId, sam.token).get("/conversations");
    expect(theirs.body.conversations).toHaveLength(1);
    const theirHistory = await chat(orgId, sam.token).get(
      `/conversations/${id}/messages`,
    );
    expect(theirHistory.body.messages).toHaveLength(2);
  });

  it("brings the chat back with only what's new", async () => {
    const { orgId, admin, sam, id } = await pair();
    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "old news",
    });
    await chat(orgId, admin.token).del(`/conversations/${id}`).expect(204);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "fresh start",
    });

    const list = await chat(orgId, admin.token).get("/conversations");
    expect(list.body.conversations).toHaveLength(1);
    expect(list.body.conversations[0].unreadCount).toBe(1);
    const history = await chat(orgId, admin.token).get(
      `/conversations/${id}/messages`,
    );
    expect(history.body.messages.map((m: { text: string }) => m.text)).toEqual([
      "fresh start",
    ]);
  });

  it("can't be done by someone who isn't in the chat", async () => {
    const { orgId, addMember, id } = await pair();
    const lee = await addMember("lee");
    await chat(orgId, lee.token).del(`/conversations/${id}`).expect(404);
  });
});

describe("marking a conversation unread", () => {
  it("brings the unread badge back", async () => {
    const { orgId, admin, sam, id } = await pair();
    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "one",
    });
    await chat(orgId, sam.token).post(`/conversations/${id}/messages`, {
      text: "two",
    });
    await chat(orgId, admin.token).post(`/conversations/${id}/read`);
    expect(
      (await chat(orgId, admin.token).get("/conversations")).body.unreadCount,
    ).toBe(0);

    await chat(orgId, admin.token)
      .post(`/conversations/${id}/unread`)
      .expect(204);
    const list = await chat(orgId, admin.token).get("/conversations");
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.conversations[0].unreadCount).toBe(1);
  });

  it("does nothing when there's nothing from others to mark", async () => {
    const { orgId, admin, id } = await pair();
    await chat(orgId, admin.token).post(`/conversations/${id}/messages`, {
      text: "just me",
    });
    await chat(orgId, admin.token)
      .post(`/conversations/${id}/unread`)
      .expect(204);
    expect(
      (await chat(orgId, admin.token).get("/conversations")).body.unreadCount,
    ).toBe(0);
  });
});

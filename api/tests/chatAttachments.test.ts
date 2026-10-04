import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const uploaded = { bytes: 100 as number | null };

vi.mock("../src/lib/cloudinary.js", () => ({
  isCloudinaryConfigured: () => true,
  fetchUploadedSize: async () => uploaded.bytes,
  signedDeliveryUrl: (publicId: string, type: string) =>
    `https://res.cloudinary.com/demo/${type}/authenticated/s--x--/${publicId}`,
  isCloudinaryUrl: (url: string) =>
    url.startsWith("https://res.cloudinary.com/demo/"),
  createUploadSignature: (folder: string) => ({
    cloudName: "demo",
    apiKey: "key",
    timestamp: 1,
    folder,
    signature: "sig",
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/auto/upload",
  }),
  destroyUpload: async () => undefined,
}));

const { createApp } = await import("../src/app.js");
const { registerAndVerify, signupInviteAndVerify, takeInvitationToken } =
  await import("./emailDeliveryMock.js");

const app = createApp();

async function twoPeople() {
  const response = await registerAndVerify(app, {
    name: "Admin User",
    email: "admin@files.test",
    password: "Harbor-lamp-91",
    orgName: "Files Org",
  });
  const token = response.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${token}`);
  const orgId = me.body.memberships[0].tenantId.id as string;
  await request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set("Authorization", `Bearer ${token}`)
    .send({ email: "sam@files.test", role: "member" });
  const signup = await signupInviteAndVerify(
    app,
    takeInvitationToken("sam@files.test"),
    "sam@files.test",
    { name: "Sam", password: "Harbor-lamp-91" },
  );
  const sam = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${signup.body.accessToken}`);
  const created = await request(app)
    .post(`/api/orgs/${orgId}/chat/conversations`)
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "direct", userId: sam.body.user.id });
  return { orgId, token, id: created.body.conversation.id as string };
}

describe("chat attachments", () => {
  it("hand out an upload signature scoped to the organization", async () => {
    const { orgId, token } = await twoPeople();
    const sign = await request(app)
      .post(`/api/orgs/${orgId}/chat/attachments/sign`)
      .set("Authorization", `Bearer ${token}`);
    expect(sign.status).toBe(200);
    expect(sign.body.folder).toBe(`worknest/${orgId}/chat`);
  });

  it("only accept files uploaded to this organization's folder", async () => {
    const { orgId, token, id } = await twoPeople();
    const send = (attachment: object) =>
      request(app)
        .post(`/api/orgs/${orgId}/chat/conversations/${id}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "", attachments: [attachment] });

    const publicId = `worknest/${orgId}/chat/abc123.txt`;
    const good = {
      url: `https://res.cloudinary.com/demo/raw/upload/v1/${publicId}`,
      publicId,
      resourceType: "raw",
      name: "notes.txt",
    };
    const ok = await send(good);
    expect(ok.status).toBe(201);
    expect(ok.body.message.attachments[0].name).toBe("notes.txt");

    // Another organization's folder.
    await send({
      ...good,
      publicId: "worknest/64b000000000000000000000/chat/x.txt",
    }).then((res) => expect(res.status).toBe(400));
    // A real link in our folder name, but pointing at someone else's file.
    await send({
      ...good,
      url: "https://res.cloudinary.com/demo/raw/upload/v1/worknest/64b000000000000000000000/chat/x.txt",
    }).then((res) => expect(res.status).toBe(400));
    // Not a Cloudinary link at all.
    await send({ ...good, url: "https://evil.example/x.txt" }).then((res) =>
      expect(res.status).toBe(400),
    );
  });
});

describe("opening chat files", () => {
  async function withFile(
    name = "notes.txt",
    mimeType = "text/plain",
    existing?: Awaited<ReturnType<typeof twoPeople>>,
  ) {
    const base = existing ?? (await twoPeople());
    const publicId = `worknest/${base.orgId}/chat/file1.${name.split(".").pop()}`;
    const sent = await request(app)
      .post(`/api/orgs/${base.orgId}/chat/conversations/${base.id}/messages`)
      .set("Authorization", `Bearer ${base.token}`)
      .send({
        text: "",
        attachments: [
          {
            url: `https://res.cloudinary.com/demo/raw/upload/v1/${publicId}`,
            publicId,
            resourceType: "raw",
            name,
            mimeType,
          },
        ],
      });
    const url = sent.body.message.attachments[0].url as string;
    return { ...base, messageId: sent.body.message.id as string, url };
  }

  it("serve the file through a signed link without exposing a public one", async () => {
    uploaded.bytes = 100;
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response("hello", { headers: { "content-length": "5" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { url } = await withFile();
      expect(url.startsWith("/api/chat-files/")).toBe(true);
      expect(url).not.toContain("cloudinary");

      const file = await request(app).get(url).buffer(true);
      expect(file.status).toBe(200);
      expect(file.text ?? file.body.toString()).toBe("hello");
      // Plain text opens in the browser; the Download button saves it.
      expect(file.headers["content-disposition"]).toContain("inline");
      expect(file.headers["content-security-policy"]).toContain("sandbox");
      const saved = await request(app).get(`${url}?download=1`).buffer(true);
      expect(saved.headers["content-disposition"]).toContain("attachment");
      expect(saved.headers["content-type"]).toContain("octet-stream");
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
      expect(file.headers["cache-control"]).toContain("private");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/authenticated/");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("show PDFs in the browser, but never let other types run as pages", async () => {
    uploaded.bytes = 100;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("%PDF-1.4", { headers: { "content-length": "8" } }),
      ),
    );
    try {
      const pdf = await withFile("report.pdf", "application/pdf");
      const opened = await request(app).get(pdf.url).buffer(true);
      expect(opened.headers["content-disposition"]).toContain("inline");
      expect(opened.headers["content-type"]).toContain("application/pdf");
      expect(opened.headers["x-content-type-options"]).toBe("nosniff");
      const saved = await request(app).get(`${pdf.url}?download=1`);
      expect(saved.headers["content-disposition"]).toContain("attachment");

      // Claiming to be a web page doesn't make it one.
      const html = await withFile("page.html", "text/html", pdf);
      const page = await request(app).get(html.url).buffer(true);
      expect(page.headers["content-disposition"]).toContain("attachment");
      expect(page.headers["content-type"]).toContain("octet-stream");
      expect(page.headers["content-security-policy"]).toContain("sandbox");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuse bad links, deleted messages and people who aren't in the chat", async () => {
    uploaded.bytes = 100;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("hello")),
    );
    try {
      const { orgId, token, url, messageId } = await withFile();
      await request(app).get("/api/chat-files/not-a-token").expect(404);

      // A valid link minted for someone who isn't in this conversation.
      const { signFileToken } = await import("../src/lib/fileToken.js");
      const stranger = signFileToken({
        userId: "64b000000000000000000000",
        orgId,
        messageId,
        index: 0,
      });
      await request(app).get(`/api/chat-files/${stranger}`).expect(404);

      await request(app).get(url).expect(200);
      await request(app)
        .delete(`/api/orgs/${orgId}/chat/messages/${messageId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      await request(app).get(url).expect(404);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stop working once the person leaves the organization", async () => {
    uploaded.bytes = 100;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("hello")),
    );
    try {
      const base = await twoPeople();
      // The sender is the admin; a link minted for the other person works
      // until their membership is gone.
      const publicId = `worknest/${base.orgId}/chat/file2.txt`;
      const sent = await request(app)
        .post(`/api/orgs/${base.orgId}/chat/conversations/${base.id}/messages`)
        .set("Authorization", `Bearer ${base.token}`)
        .send({
          text: "",
          attachments: [
            {
              url: `https://res.cloudinary.com/demo/raw/upload/v1/${publicId}`,
              publicId,
              resourceType: "raw",
              name: "n.txt",
            },
          ],
        });
      const samToken = (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "sam@files.test", password: "Harbor-lamp-91" })
      ).body.accessToken as string;
      const list = await request(app)
        .get(`/api/orgs/${base.orgId}/chat/conversations/${base.id}/messages`)
        .set("Authorization", `Bearer ${samToken}`);
      const samUrl = list.body.messages.find(
        (m: { id: string }) => m.id === sent.body.message.id,
      ).attachments[0].url as string;
      await request(app).get(samUrl).expect(200);

      const members = await request(app)
        .get(`/api/orgs/${base.orgId}/members`)
        .set("Authorization", `Bearer ${base.token}`);
      const samMembership = members.body.members.find(
        (m: { userId: { email: string } }) =>
          m.userId.email === "sam@files.test",
      )._id as string;
      await request(app)
        .delete(`/api/orgs/${base.orgId}/members/${samMembership}`)
        .set("Authorization", `Bearer ${base.token}`)
        .expect(204);
      await request(app).get(samUrl).expect(404);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reject a file that's bigger than the limit, whatever the browser said", async () => {
    uploaded.bytes = 11 * 1024 * 1024;
    const { orgId, token, id } = await twoPeople();
    const publicId = `worknest/${orgId}/chat/big.bin`;
    const res = await request(app)
      .post(`/api/orgs/${orgId}/chat/conversations/${id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        text: "",
        attachments: [
          {
            url: `https://res.cloudinary.com/demo/raw/upload/v1/${publicId}`,
            publicId,
            resourceType: "raw",
            name: "big.bin",
            size: 10,
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
    uploaded.bytes = 100;
  });
});

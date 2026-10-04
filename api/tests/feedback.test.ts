import { describe, expect, it, vi } from "vitest";

// The address is read when the app starts, so set it first.
vi.hoisted(() => {
  process.env.FEEDBACK_TO_EMAIL = "owner@feedback.test";
});

import request from "supertest";
import { createApp } from "../src/app.js";
import { setupOrg } from "./orgHelpers.js";
import { takeFeedbackEmails } from "./emailDeliveryMock.js";

const app = createApp();
app.set("trust proxy", 1);
let counter = 1;
const ip = () => `192.0.2.${counter++}`;

describe("feedback form", () => {
  it("says it is switched on", async () => {
    const res = await request(app).get("/api/feedback");
    expect(res.body).toEqual({ enabled: true });
  });

  it("emails feedback from someone who isn't signed in", async () => {
    takeFeedbackEmails();
    const res = await request(app)
      .post("/api/feedback")
      .set("X-Forwarded-For", ip())
      .send({
        message: "The landing page is lovely.",
        email: "reader@feedback.test",
        page: "/",
      });
    expect(res.status).toBe(202);
    const [sent] = takeFeedbackEmails();
    expect(sent.to).toBe("owner@feedback.test");
    expect(sent.message).toBe("The landing page is lovely.");
    expect(sent.senderEmail).toBe("reader@feedback.test");
    expect(sent.senderName).toBeNull();
  });

  it("uses the signed-in account's name and email", async () => {
    takeFeedbackEmails();
    const { admin } = await setupOrg(app, "feedback2.test");
    const res = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("X-Forwarded-For", ip())
      .send({ message: "The board is easy to use.", email: "ignored@x.test" });
    expect(res.status).toBe(202);
    const [sent] = takeFeedbackEmails();
    expect(sent.senderName).toBe("Admin User");
    expect(sent.senderEmail).toBe("admin@feedback2.test");
  });

  it("rejects an empty message and drops bot submissions quietly", async () => {
    takeFeedbackEmails();
    await request(app)
      .post("/api/feedback")
      .set("X-Forwarded-For", ip())
      .send({ message: "hi" })
      .expect(400);
    const bot = await request(app)
      .post("/api/feedback")
      .set("X-Forwarded-For", ip())
      .send({ message: "Buy cheap watches now", website: "http://spam.test" });
    expect(bot.status).toBe(202);
    expect(takeFeedbackEmails()).toHaveLength(0);
  });

  it("attaches a screenshot only from signed-in people, and only real images", async () => {
    takeFeedbackEmails();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString(
      "base64",
    );
    const shot = `data:image/png;base64,${png}`;
    const body = { message: "Here is what I see.", screenshot: shot };

    const anonymous = await request(app)
      .post("/api/feedback")
      .set("X-Forwarded-For", ip())
      .send(body);
    expect(anonymous.status).toBe(400);
    expect(anonymous.body.error.code).toBe("ATTACHMENT_REQUIRES_SIGN_IN");

    const { admin } = await setupOrg(app, "feedback3.test");
    const fake = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("X-Forwarded-For", ip())
      .send({
        ...body,
        screenshot: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`,
      });
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe("INVALID_ATTACHMENT");

    const ok = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("X-Forwarded-For", ip())
      .send(body);
    expect(ok.status).toBe(202);
    const [sent] = takeFeedbackEmails();
    expect(sent.attachment?.name).toBe("screenshot.png");
  });

  it("limits how many a person can send in an hour", async () => {
    const same = "198.18.0.1";
    let last = 0;
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post("/api/feedback")
        .set("X-Forwarded-For", same)
        .send({ message: `Message number ${i} for the limit` });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

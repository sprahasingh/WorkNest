import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.FEEDBACK_TO_EMAIL;
});

import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("feedback form when no address is set", () => {
  it("says it is off and refuses to send", async () => {
    const status = await request(app).get("/api/feedback");
    expect(status.body).toEqual({ enabled: false });
    const res = await request(app)
      .post("/api/feedback")
      .send({ message: "Anyone there?" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("FEEDBACK_UNAVAILABLE");
  });
});
